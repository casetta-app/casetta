export type AdditionRequest = {
  p_format_id: string | null
  p_product: Record<string, string | null> | null
  p_initial_state: object
}
export type AdditionResult = {
  home_product_id: string
  created: boolean
  movement_id: string | null
}

// Una risposta persa conserva la chiave: anche dopo refresh il retry non ricrea metadati.
export async function atomicAddition(
  rpc: (
    args: AdditionRequest & { p_home_id: string; p_key: string },
  ) => Promise<unknown>,
  store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  newKey: () => string,
  actorId: string,
  homeId: string,
  request: AdditionRequest,
): Promise<AdditionResult> {
  const storageKey = `casetta:inventory-add:${actorId}:${homeId}:${JSON.stringify(request)}`
  let key = store.getItem(storageKey)
  if (!key) {
    key = newKey()
    store.setItem(storageKey, key)
  }
  const data = await rpc({ ...request, p_home_id: homeId, p_key: key })
  if (
    !data ||
    typeof data !== 'object' ||
    !('home_product_id' in data) ||
    typeof data.home_product_id !== 'string' ||
    !('created' in data) ||
    typeof data.created !== 'boolean' ||
    !('movement_id' in data) ||
    (data.movement_id !== null && typeof data.movement_id !== 'string')
  ) {
    throw new Error(
      'Supabase non ha restituito un esito valido per il prodotto.',
    )
  }
  store.removeItem(storageKey)
  return data as AdditionResult
}
