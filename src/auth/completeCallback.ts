import { readCallback } from './redirect.ts'

type CallbackDependencies = {
  replaceUrl: (url: string) => void
  exchange: ((code: string) => Promise<{ error: unknown }>) | null
}
// Separato dal browser e dal client per verificare l'orchestrazione senza credenziali.
export async function completeCallback(
  href: string,
  { replaceUrl, exchange }: CallbackDependencies,
): Promise<string | null> {
  const callback = readCallback(href)
  if (!callback.isCallback) return null
  replaceUrl(callback.cleanUrl)
  if (!exchange)
    return 'Configura Supabase prima di aprire nuovamente il link email.'
  if (callback.error)
    return 'Il link email non è valido o è scaduto. Richiedine uno nuovo.'
  if (callback.code) {
    try {
      const { error } = await exchange(callback.code)
      if (error)
        return 'Link scaduto, già usato o aperto in un browser diverso. Richiedi un nuovo link dallo stesso browser.'
    } catch {
      return 'Connessione non riuscita. Richiedi un nuovo link email.'
    }
  }
  return null
}
