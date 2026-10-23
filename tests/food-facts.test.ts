import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchOff,
  parseOff,
  canonicalCode,
} from '../supabase/functions/_shared/off.ts'
import { localFirst, deduplicate } from '../src/recognition/lookup.ts'
const code = '4006381333931'
const complete = {
  product: {
    code,
    product_name_it: 'Pasta italiana',
    product_name: 'Pasta',
    brands: 'Marca',
    quantity: '500 g',
    product_quantity: 500,
    product_quantity_unit: 'g',
  },
}
test('fixture OFF completa preferisce italiano e non inventa quantità posseduta', () => {
  const result = parseOff(complete, code)
  assert.equal(result.status, 'found')
  if (result.status === 'found') {
    assert.equal(result.proposal.name, 'Pasta italiana')
    assert.equal(result.proposal.quantity, '500')
    assert.equal('stockQuantity' in result.proposal, false)
  }
  assert.equal(parseOff({ product: { code } }, code).status, 'incomplete')
  assert.equal(
    parseOff({ product: { code: '96385074', product_name: 'Diverso' } }, code)
      .status,
    'unavailable',
  )
})
test('404,429,503,timeout e rete sono distinti e UA/fields server-side sono richiesti', async () => {
  for (const [http, status] of [
    [404, 'absent'],
    [429, 'limited'],
    [503, 'unavailable'],
  ] as const) {
    const result = await fetchOff(
      code,
      'Casetta/test',
      async (url, options) => {
        assert.match(String(url), /api\/v3\/product/)
        assert.match(String(url), /fields=/)
        assert.equal(
          (options?.headers as Record<string, string>)['User-Agent'],
          'Casetta/test',
        )
        return new Response('', { status: http })
      },
    )
    assert.equal(result.status, status)
  }
  assert.equal(
    (
      await fetchOff(code, 'test', async () => {
        throw new TypeError('offline')
      })
    ).status,
    'network',
  )
  assert.equal(
    (
      await fetchOff(
        code,
        'test',
        async (_, options) =>
          new Promise((_, reject) =>
            options?.signal?.addEventListener('abort', () =>
              reject(Error('timeout')),
            ),
          ),
        1,
      )
    ).status,
    'timeout',
  )
  assert.equal(
    (await fetchOff(code, 'test', async () => Response.json(complete))).status,
    'found',
  )
})
test('catalogo locale anche ambiguo impedisce chiamate esterne, errori locali non sono miss', async () => {
  let calls = 0
  const external = async () => {
    calls++
    return { status: 'absent' } as const
  }
  for (const matches of [[1], [1, 2]])
    assert.equal(
      (await localFirst(async () => matches, external)).status,
      'local',
    )
  await assert.rejects(() =>
    localFirst(async () => {
      throw Error('RLS/network')
    }, external),
  )
  assert.equal(calls, 0)
  assert.equal((await localFirst(async () => [], external)).status, 'absent')
  assert.equal(calls, 1)
})
test('richieste concorrenti UPC/EAN equivalenti deduplicate e abitazioni separate', async () => {
  let calls = 0
  let release: () => void = () => {}
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  const lookup = deduplicate(async () => {
    calls++
    await wait
    return 'found'
  })
  const a = lookup('a', '036000291452'),
    b = lookup('a', '0036000291452'),
    c = lookup('b', '036000291452')
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.equal(calls, 2)
  release()
  await Promise.all([a, b, c])
  assert.equal(canonicalCode('036000291452'), '0036000291452')
})

test('risposte Edge malformate non raggiungono la UI; incompleti ed equivalenze rimangono validi', async () => {
  const { validateOffResult } =
    await import('../supabase/functions/_shared/off.ts')
  const valid = parseOff(complete, code)
  assert.deepEqual(validateOffResult(valid, code), valid)
  const incomplete = parseOff({ product: { code } }, code)
  assert.deepEqual(validateOffResult(incomplete, code), incomplete)
  const proposal = valid.status === 'found' ? valid.proposal : null
  for (const value of [
    null,
    [],
    {},
    'found',
    { status: {} },
    { status: 'found' },
    { status: 'found', proposal: null },
    { status: 'found', proposal: [] },
    { status: 'found', proposal: { ...proposal, name: 7 } },
    { status: 'incomplete', proposal: { ...proposal, quantity: null } },
    {
      status: 'found',
      proposal: { ...proposal, sourceRef: 'javascript:alert(1)' },
    },
    { status: 'found', proposal: { ...proposal, barcode: '96385074' } },
    { status: 'limited', retryAfter: '10' },
  ])
    assert.equal(validateOffResult(value, code).status, 'unavailable')
  const upc = parseOff({ product: { code: '0036000291452' } }, '036000291452')
  assert.deepEqual(validateOffResult(upc, '0036000291452'), upc)
  for (const body of [
    null,
    {},
    { product: [] },
    { product: { code, brands: { bad: true } } },
    { product: { code, product_name_it: ['name'] } },
    { product: { code, product_quantity: { bad: true } } },
  ])
    assert.equal(parseOff(body, code).status, 'unavailable')
  for (const status of [401, 403])
    assert.equal(
      (await fetchOff(code, 'test', async () => new Response('', { status })))
        .status,
      'unavailable',
    )
  assert.equal(
    (
      await fetchOff(
        code,
        'test',
        async () => new Response('{', { status: 200 }),
      )
    ).status,
    'unavailable',
  )
})

test('editoriali: catalogo prioritario, nessun OFF su 977/978/979 e nessun dato inventato', async () => {
  let calls = 0
  const external = async () => {
    calls++
    return { status: 'absent' } as const
  }
  for (const barcode of ['9771125522005', '9780306406157', '9791090636071']) {
    assert.deepEqual(await localFirst(async () => [], external, barcode), {
      status: 'editorial',
    })
    assert.deepEqual(
      await localFirst(async () => ['locale'], external, barcode),
      { status: 'local', matches: ['locale'] },
    )
    await assert.rejects(() =>
      localFirst(
        async () => {
          throw Error('rete')
        },
        external,
        barcode,
      ),
    )
  }
  assert.equal(calls, 0)
  // Other EANs do not establish a food category: external absence stays absence.
  assert.equal(
    (await localFirst(async () => [], external, '4006381333931')).status,
    'absent',
  )
  assert.equal(calls, 1)
})
