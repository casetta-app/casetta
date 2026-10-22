import { supabase } from '../lib/supabase'
import { completeCallback } from './completeCallback'

export function bootstrapAuth(): Promise<string | null> {
  const client = supabase
  return completeCallback(window.location.href, {
    // Rimuove subito il codice prima di avviare React/HashRouter.
    replaceUrl: (url) => window.history.replaceState(null, '', url),
    exchange: client
      ? (code) => client.auth.exchangeCodeForSession(code)
      : null,
  })
}
