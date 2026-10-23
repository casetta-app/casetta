import type { OffResult } from '../../supabase/functions/_shared/off.ts'
import { canonicalCode } from '../../supabase/functions/_shared/off.ts'
export type ExternalResult = OffResult | { status: 'editorial' }
// A prefix identifies an editorial allocation, never the publication title.
export const isEditorialBarcode = (code: string) => /^97[789]\d{10}$/.test(code)
export async function localFirst<T>(
  local: () => Promise<T[]>,
  external: () => Promise<OffResult>,
  code = '',
): Promise<{ status: 'local'; matches: T[] } | ExternalResult> {
  const matches = await local()
  if (matches.length) return { status: 'local', matches }
  return isEditorialBarcode(code) ? { status: 'editorial' } : external()
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
