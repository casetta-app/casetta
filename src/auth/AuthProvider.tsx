import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { AuthContext } from './AuthContext'

export function AuthProvider({
  children,
  initialError,
}: {
  children: ReactNode
  initialError: string | null
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(initialError)
  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let active = true
    let revision = 0
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return
      ++revision
      setSession(next)
      if (event === 'SIGNED_IN') setError(null)
      setLoading(false)
      if (event === 'PASSWORD_RECOVERY') window.location.hash = '/password'
    })
    const initialRevision = revision
    void supabase.auth
      .getSession()
      .then(({ data, error: failure }) => {
        if (active && revision === initialRevision) {
          setSession(data.session)
          setLoading(false)
          if (failure) setError('Sessione non disponibile. Accedi nuovamente.')
        }
      })
      .catch(() => {
        if (active && revision === initialRevision) {
          setLoading(false)
          setError('Impossibile recuperare la sessione.')
        }
      })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])
  return (
    <AuthContext.Provider value={{ session, loading, error }}>
      {children}
    </AuthContext.Provider>
  )
}
