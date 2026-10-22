// Validate syntax only here; Supabase Auth verifies signature, expiry and user.
export function bearerJwt(value: string | null): string | null {
  return (
    value?.match(
      /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i,
    )?.[1] ?? null
  )
}
export async function boundedJson(
  request: Request,
  limit = 1024,
): Promise<unknown> {
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new Error('Invalid body size')
  if (!request.body) throw new Error('Missing body')
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0,
    text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) {
        void reader.cancel().catch(() => {})
        throw new Error('Body too large')
      }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode()) as unknown
  } finally {
    reader.releaseLock()
  }
}
export function validHomeRequest(
  body: unknown,
): body is { homeId: string; code: string } {
  return Boolean(
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'homeId' in body &&
    typeof body.homeId === 'string' &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.homeId) &&
    'code' in body &&
    typeof body.code === 'string',
  )
}
