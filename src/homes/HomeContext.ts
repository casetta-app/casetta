import { createContext, useContext } from 'react'
import type { HomeSummary } from '../domain/home'
export type HomesState = {
  homes: HomeSummary[]
  activeHome: HomeSummary | null
  loading: boolean
  error: string
  notice: string
  refresh: (preferredId?: string) => Promise<void>
  selectHome: (id: string) => void
}
export const HomeContext = createContext<HomesState | null>(null)
export function useHomes() {
  const value = useContext(HomeContext)
  if (!value) throw new Error('HomeProvider required')
  return value
}
