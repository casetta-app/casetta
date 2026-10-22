export type NavigationItem = {
  label: string
  path: string
  icon: 'sun' | 'boxes' | 'basket' | 'settings'
}

export const navigationItems: NavigationItem[] = [
  { label: 'Oggi', path: '/oggi', icon: 'sun' },
  { label: 'Scorte', path: '/scorte', icon: 'boxes' },
  { label: 'Spesa', path: '/spesa', icon: 'basket' },
  { label: 'Gestione', path: '/gestione', icon: 'settings' },
]
