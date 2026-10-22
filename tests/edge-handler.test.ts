import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url),
  ts = require('typescript')
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJl'
const homeId = '00000000-0000-4000-8000-000000000111',
  userId = '00000000-0000-4000-8000-000000000222'
test('Edge: bearer/JWT esplicito, validazione anticipata, ruoli e contesto RLS', async () => {
  let handler: (r: Request) => Promise<Response> = async () =>
    new Response('', { status: 500 })
  let expired = false,
    role = 'viewer',
    claims = 0,
    authCalls = 0,
    membershipCalls = 0,
    verifiedToken = '',
    membershipMissing = false,
    membershipError = false
  const filters: string[][] = []
  const userClient = {
    auth: {
      getUser: async (token: string) => {
        authCalls++
        verifiedToken = token
        assert.equal(token, jwt)
        return {
          data: { user: expired ? null : { id: userId } },
          error: expired ? Error('expired') : null,
        }
      },
    },
    from: (table: string) => {
      assert.equal(table, 'home_members')
      membershipCalls++
      const q = {
        select: () => q,
        eq: (key: string, value: string) => {
          filters.push([key, value])
          return q
        },
        is: (key: string, value: unknown) => {
          assert.equal(key, 'revoked_at')
          assert.equal(value, null)
          return q
        },
        maybeSingle: async () => ({
          data: membershipMissing ? null : { role },
          error: membershipError ? Error('database unavailable') : null,
        }),
      }
      return q
    },
    rpc: () => assert.fail('User client must not access private cache'),
  }
  const serviceClient = {
    from: () => assert.fail('Service role must not authorize/read homes'),
    rpc: async () => {
      claims++
      return {
        data: { state: 'cached', result: { status: 'absent' } },
        error: null,
      }
    },
  }
  const context = globalThis as unknown as {
    Deno: unknown
    __edgeClient: unknown
  }
  context.Deno = {
    env: {
      get: (name: string) =>
        name === 'APP_ORIGIN' ? 'https://casetta-app.github.io' : name,
    },
    serve: (fn: typeof handler) => {
      handler = fn
    },
  }
  context.__edgeClient = {
    createClient: (
      _url: string,
      key: string,
      options: { global?: { headers: { Authorization: string } } },
    ) => {
      if (key === 'SUPABASE_SERVICE_ROLE_KEY') {
        assert.equal(options.global, undefined)
        return serviceClient
      }
      assert.equal(options.global?.headers.Authorization, `Bearer ${jwt}`)
      return userClient
    },
  }
  const source = readFileSync(
    new URL('../supabase/functions/food-facts/index.ts', import.meta.url),
    'utf8',
  )
  let js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText as string
  js = js.replace(
    /import \{ createClient \} from ['"]npm:[^'"]+['"];?/,
    'const {createClient}=globalThis.__edgeClient;',
  )
  for (const name of ['off', 'request'])
    js = js.replace(
      `../_shared/${name}.ts`,
      new URL(`../supabase/functions/_shared/${name}.ts`, import.meta.url).href,
    )
  js = js.replace(
    '../../../src/scanner/codes.ts',
    new URL('../src/scanner/codes.ts', import.meta.url).href,
  )
  try {
    await import(
      `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
    )
    const request = (
      authorization: string | null = `Bearer ${jwt}`,
      raw = JSON.stringify({
        homeId,
        code: '4006381333931',
        userId: 'untrusted-body-id',
      }),
      origin = 'https://casetta-app.github.io',
    ) =>
      new Request('https://function.invalid', {
        method: 'POST',
        headers: {
          Origin: origin,
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body: raw,
      })
    for (const header of [
      null,
      'Basic abc',
      'Bearer',
      'Bearer a.b',
      'Bearer a.b.c extra',
      'Bearer a..c',
    ])
      assert.equal((await handler(request(header))).status, 401)
    assert.equal(authCalls, 0)
    for (const body of [
      '{',
      'null',
      '[]',
      JSON.stringify({ homeId: 'not-uuid', code: '4006381333931' }),
      JSON.stringify({ homeId, code: '4006381333932' }),
      JSON.stringify({ homeId, code: 4006381333931 }),
      ' '.repeat(1025),
    ])
      assert.equal((await handler(request(`Bearer ${jwt}`, body))).status, 400)
    assert.equal(authCalls, 0)
    assert.equal(membershipCalls, 0)
    const declaredLarge = request()
    declaredLarge.headers.set('Content-Length', '1000000')
    assert.equal((await handler(declaredLarge)).status, 400)
    assert.equal(declaredLarge.bodyUsed, false)
    let chunks = 0,
      cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks++
        controller.enqueue(new Uint8Array(600))
      },
      cancel() {
        cancelled = true
      },
    })
    const streamed = new Request('https://function.invalid', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    assert.equal((await handler(streamed)).status, 400)
    assert.ok(cancelled)
    assert.ok(chunks < 5)
    assert.equal(authCalls, 0)
    assert.equal(
      (
        await handler(
          request(`Bearer ${jwt}`, undefined, 'https://other.invalid'),
        )
      ).status,
      403,
    )
    expired = true
    assert.equal((await handler(request())).status, 401)
    assert.equal(verifiedToken, jwt)
    assert.equal(membershipCalls, 0)
    expired = false
    assert.equal((await handler(request())).status, 403)
    membershipMissing = true
    assert.equal((await handler(request())).status, 403)
    membershipMissing = false
    membershipError = true
    assert.equal((await handler(request())).status, 503)
    membershipError = false
    assert.equal(claims, 0)
    for (role of ['editor', 'owner']) {
      const response = await handler(request())
      assert.equal(response.status, 200)
      assert.equal((await response.json()).status, 'absent')
      assert.equal(
        response.headers.get('Access-Control-Allow-Origin'),
        'https://casetta-app.github.io',
      )
    }
    assert.equal(claims, 2)
    assert.ok(
      filters.some(([key, value]) => key === 'user_id' && value === userId),
    )
    assert.ok(!filters.some(([, value]) => value === 'untrusted-body-id'))
    assert.match(
      readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
      /verify_jwt\s*=\s*true/,
    )
  } finally {
    Reflect.deleteProperty(globalThis, 'Deno')
    Reflect.deleteProperty(globalThis, '__edgeClient')
  }
})
