export function chooseHome<T extends { id: string }>(
  homes: T[],
  preferred: string | null,
): T | null {
  return homes.find((home) => home.id === preferred) ?? homes[0] ?? null
}
export function preferenceKey(userId: string) {
  return `casetta:${userId}:home`
}
export const roleLabels = {
  owner: 'Proprietario',
  editor: 'Può modificare',
  viewer: 'Sola lettura',
} as const
