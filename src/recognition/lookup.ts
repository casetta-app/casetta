import type { OffResult } from '../../supabase/functions/_shared/off.ts'
import { canonicalCode } from '../../supabase/functions/_shared/off.ts'
export async function localFirst<T>(
  local: () => Promise<T[]>,
  external: () => Promise<OffResult>,
): Promise<{ status: 'local'; matches: T[] } | OffResult> {
  const matches = await local()
  return matches.length ? { status: 'local', matches } : external()
}
export function deduplicate<T>(
  fetcher: (home: string, code: string) => Promise<T>,
) {
  const pending = new Map<string, Promise<T>>()
  return (home: string, code: string) => {
    const canonical = canonicalCode(code),
      key = `${home}:${canonical}`
    const existing = pending.get(key)
    if (existing) return existing
    const request = fetcher(home, canonical).finally(() => pending.delete(key))
    pending.set(key, request)
    return request
  }
}
