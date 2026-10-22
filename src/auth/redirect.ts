export function authRedirect(origin: string, base: string, recovery = false) {
  const url = new URL(base, origin)
  if (recovery) url.searchParams.set('recovery', '1')
  return url.href
}

export function readCallback(href: string) {
  const url = new URL(href)
  const code = url.searchParams.get('code')
  const error =
    url.searchParams.get('error_description') || url.searchParams.get('error')
  const recovery = url.searchParams.get('recovery') === '1'
  const isCallback = Boolean(code || error)
  if (isCallback) {
    for (const name of [
      'code',
      'error',
      'error_code',
      'error_description',
      'recovery',
    ])
      url.searchParams.delete(name)
    url.hash = recovery && code ? '/password' : '/oggi'
  }
  return { code, error, recovery, isCallback, cleanUrl: url.href }
}
