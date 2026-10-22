import { supabase } from '../lib/supabase'
import { findBarcodeFormats } from '../inventory/api'
import { barcodeVariants } from '../scanner/codes'
import { localFirst, deduplicate } from './lookup'
import {
  validateOffResult,
  type OffResult,
} from '../../supabase/functions/_shared/off'
const external = deduplicate(
  async (homeId: string, code: string): Promise<OffResult> => {
    if (!supabase) return { status: 'unavailable' }
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 10000)
    try {
      const { data, error } = await supabase.functions.invoke('food-facts', {
        body: { homeId, code },
        signal: controller.signal,
      })
      if (error)
        return {
          status: timedOut
            ? 'timeout'
            : error.name === 'FunctionsFetchError'
              ? 'network'
              : error.context?.status === 429
                ? 'limited'
                : 'unavailable',
        }
      return validateOffResult(data, code)
    } catch (error) {
      return {
        status:
          error instanceof Error &&
          ['TimeoutError', 'AbortError'].includes(error.name)
            ? 'timeout'
            : 'network',
      }
    } finally {
      clearTimeout(timer)
    }
  },
)
export function recognizeProduct(homeId: string, code: string) {
  return localFirst(
    () => findBarcodeFormats(homeId, barcodeVariants(code)),
    () => external(homeId, code),
  )
}
