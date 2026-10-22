import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
export const AuthContext = createContext<{
  session: Session | null
  loading: boolean
  error: string | null
}>({ session: null, loading: true, error: null })
export const useAuth = () => useContext(AuthContext)
