export function normalizeBarcode(input: string): string | null {
  const code = input.trim()
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return null
  let sum = 0
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight)
    sum += Number(code[i]) * weight
  return (10 - (sum % 10)) % 10 === Number(code.at(-1)) ? code : null
}

export function barcodeVariants(code: string): string[] {
  if (code.length === 12) return [code, `0${code}`]
  if (code.length === 13 && code.startsWith('0')) return [code, code.slice(1)]
  return [code]
}

export function cameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Accesso alla fotocamera negato. Abilitalo nelle impostazioni oppure inserisci il codice a mano.'
  if (name === 'NotReadableError')
    return 'Fotocamera occupata da un’altra app. Chiudila e riprova, oppure inserisci il codice a mano.'
  if (name === 'NotSupportedError')
    return 'Fotocamera non supportata: usa HTTPS e un browser compatibile oppure inserisci il codice a mano.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'Nessuna fotocamera disponibile. Inserisci il codice a mano.'
  return 'Fotocamera non disponibile. Riprova oppure inserisci il codice a mano.'
}
