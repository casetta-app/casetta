import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'
import { storage } from '../lib/storage'
import type { HomeSummary, HomeRole } from '../domain/home'
import { chooseHome, preferenceKey } from './selection'
import { HomeContext } from './HomeContext'

export function HomeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session!.user.id
  const [homes, setHomes] = useState<HomeSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const sequence = useRef(0)
  const mounted = useRef(false)
  const activeRef = useRef<string | null>(null)
  const refresh = useCallback(
    async (preferredId?: string) => {
      const request = ++sequence.current
      // Nasconde i dati precedenti finché il database non riconferma l'accesso.
      setLoading(true)
      setError('')
      try {
        const { data, error } = await supabase!
          .from('home_members')
          .select('home_id, user_id, role, relationship, homes!inner(id, name)')
          .eq('user_id', userId)
          .is('revoked_at', null)
          .order('joined_at')
        if (request !== sequence.current || !mounted.current) return
        if (error) throw error
        const next: HomeSummary[] = (data ?? []).flatMap((row) => {
          const home = row.homes as unknown as { id: string; name: string }
          if (!home || !['owner', 'editor', 'viewer'].includes(row.role))
            return []
          return [
            {
              id: home.id,
              name: home.name,
              access: {
                homeId: home.id,
                userId,
                role: row.role as HomeRole,
                relationship: row.relationship as 'resident' | 'guest',
              },
            },
          ]
        })
        const preferred =
          preferredId ?? activeRef.current ?? storage.get(preferenceKey(userId))
        const chosen = chooseHome(next, preferred)
        if (preferred && !next.some((home) => home.id === preferred))
          setNotice(
            'La casa selezionata non è più accessibile. Scegli una delle case disponibili o creane una.',
          )
        setHomes(next)
        setActiveId(chosen?.id ?? null)
        activeRef.current = chosen?.id ?? null
        if (chosen) storage.set(preferenceKey(userId), chosen.id)
        else storage.remove(preferenceKey(userId))
      } catch {
        if (request === sequence.current && mounted.current) {
          setHomes([])
          setActiveId(null)
          setError(
            'Impossibile verificare gli accessi. Controlla la connessione e riprova. I dati precedenti sono stati nascosti.',
          )
        }
      } finally {
        if (request === sequence.current && mounted.current) setLoading(false)
      }
    },
    [userId],
  )
  useEffect(() => {
    mounted.current = true
    void refresh()
    const check = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        ++sequence.current
        setLoading(true)
      } else void refresh()
    }
    const interval = window.setInterval(check, 30_000)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', visibility)
    const invalidate = () => {
      ++sequence.current
    }
    return () => {
      mounted.current = false
      invalidate()
      clearInterval(interval)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [refresh])
  function selectHome(id: string) {
    if (!homes.some((home) => home.id === id)) return
    activeRef.current = id
    setActiveId(id)
    storage.set(preferenceKey(userId), id)
    setNotice('')
    void refresh()
  }
  return (
    <HomeContext.Provider
      value={{
        homes,
        activeHome: homes.find((h) => h.id === activeId) ?? null,
        loading,
        error,
        notice,
        refresh,
        selectHome,
      }}
    >
      {children}
    </HomeContext.Provider>
  )
}
