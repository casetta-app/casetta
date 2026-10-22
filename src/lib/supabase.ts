import { createClient } from '@supabase/supabase-js'

function configuredClient() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  // Accetta esclusivamente le nuove chiavi pubblicabili, mai JWT privilegiati.
  if (!url || !key?.startsWith('sb_publishable_')) return null
  try {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol)) return null
    return createClient(url, key, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  } catch {
    return null
  }
}
export const supabase = configuredClient()
