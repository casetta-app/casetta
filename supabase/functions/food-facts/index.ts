import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { bearerJwt, boundedJson, validHomeRequest } from '../_shared/request.ts'
import { canonicalCode, fetchOff, validateOffResult } from '../_shared/off.ts'
import { normalizeBarcode } from '../../../src/scanner/codes.ts'
const origin = Deno.env.get('APP_ORIGIN') || 'https://casetta-app.github.io'
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers':
    'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  Vary: 'Origin',
}
Deno.serve(async (request) => {
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers })
  if (request.headers.get('origin') && request.headers.get('origin') !== origin)
    return reply(403, { status: 'forbidden' })
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply(405, { status: 'invalid' })
  try {
    const jwt = bearerJwt(request.headers.get('authorization'))
    if (!jwt) return reply(401, { status: 'unauthorized' })
    let body: unknown
    try {
      body = await boundedJson(request)
    } catch {
      return reply(400, { status: 'invalid' })
    }
    if (!validHomeRequest(body)) return reply(400, { status: 'invalid' })
    const code = normalizeBarcode(body.code)
    if (!code) return reply(400, { status: 'invalid' })
    const authorization = `Bearer ${jwt}`
    const url = Deno.env.get('SUPABASE_URL')!,
      anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const client = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    })
    const {
      data: { user },
      error,
    } = await client.auth.getUser(jwt)
    if (error || !user) return reply(401, { status: 'unauthorized' })
    const membership = await client
      .from('home_members')
      .select('role')
      .eq('home_id', body.homeId)
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .maybeSingle()
    if (membership.error) return reply(503, { status: 'unavailable' })
    if (!membership.data || !['owner', 'editor'].includes(membership.data.role))
      return reply(403, { status: 'forbidden' })
    const service = createClient(
      url,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )
    const barcode = canonicalCode(code)
    const claim = await service.rpc('claim_food_lookup', {
      actor: user.id,
      barcode,
    })
    if (claim.error) return reply(503, { status: 'unavailable' })
    if (claim.data.state === 'cached')
      return reply(200, validateOffResult(claim.data.result, barcode))
    if (claim.data.state !== 'fetch')
      return reply(200, {
        status: claim.data.state === 'pending' ? 'unavailable' : 'limited',
        retryAfter: 7,
      })
    const result = await fetchOff(
      barcode,
      'Casetta/2-B (https://github.com/casetta-app/casetta)',
    )
    const finished = await service.rpc('finish_food_lookup', {
      barcode,
      token: claim.data.lease,
      response: result,
    })
    if (finished.error) return reply(503, { status: 'unavailable' })
    return reply(200, result)
  } catch {
    return reply(503, { status: 'unavailable' })
  }
})
