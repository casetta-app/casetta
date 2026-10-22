export type HomeRole = 'owner' | 'editor' | 'viewer'

export type HomeAccess = {
  homeId: string
  userId: string
  role: HomeRole
  relationship: 'resident' | 'guest'
}

export type HomeSummary = {
  id: string
  name: string
  access: HomeAccess
}
