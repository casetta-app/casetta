import { atomicAddition, type AdditionRequest } from './addition'
import { supabase } from '../lib/supabase'
import type {
  InventoryCategory,
  InventoryProduct,
  InventoryState,
  PackageState,
  StockCertainty,
  StockEntry,
  StockLevel,
  StockMode,
  StockUnit,
  FormatKind,
} from './model'

type DbError = {
  code?: string
  message?: string
  details?: string
  hint?: string
}

export class InventoryError extends Error {
  code: string | undefined

  constructor(error: DbError | Error) {
    super(error.message || 'Errore non specificato')
    this.name = 'InventoryError'
    this.code = 'code' in error ? error.code : undefined
  }
}

function client() {
  if (!supabase) throw new Error('Collegamento a Supabase non configurato.')
  return supabase
}

function raise(error: DbError | null) {
  if (error) throw new InventoryError(error)
}

type DbEntryRow = {
  id: string
  mode: string
  quantity: string | null
  unit: string | null
  level: string | null
  certainty: string
  package_state: string
  package_count: number | null
  location_id: string | null
  expires_on: string | null
  version: number
  storage_locations: { id: string; name: string } | null
}

type DbHomeProductRow = {
  id: string
  format_id: string
  alias: string | null
  product_formats: {
    id: string
    label: string
    kind: string
    size_unit: string | null
    products: {
      id: string
      name: string
      brand: string | null
      category: string
      source_ref: string | null
    }
  }
  stock_entries: DbEntryRow[] | null
}

function normalizeEntry(row: DbEntryRow): StockEntry {
  const location = row.storage_locations
  return {
    id: row.id,
    mode: row.mode as StockMode,
    quantity: row.quantity === null ? null : String(row.quantity),
    unit: row.unit as StockUnit | null,
    level: row.level as StockLevel | null,
    certainty: row.certainty as StockCertainty,
    package_state: row.package_state as PackageState,
    package_count: row.package_count,
    location_id: row.location_id,
    expires_on: row.expires_on,
    version: Number(row.version),
    location: location ? { id: location.id, name: location.name } : null,
  }
}

export async function loadInventory(
  homeId: string,
): Promise<InventoryProduct[]> {
  const { data, error } = await client()
    .from('home_products')
    .select(
      'id, format_id, alias, product_formats!inner(id, label, kind, size_unit, products!inner(id, name, brand, category, source_ref)), stock_entries(id, mode, quantity::text, unit, level, certainty, package_state, package_count, location_id, expires_on, version, storage_locations(id, name))',
    )
    .eq('home_id', homeId)
    .order('created_at')
  raise(error)
  return ((data ?? []) as unknown as DbHomeProductRow[]).flatMap((raw) => {
    const format = raw.product_formats
    const product = format?.products
    if (!format || !product) return []
    return [
      {
        id: raw.id,
        formatId: raw.format_id,
        name: product.name,
        brand: product.brand,
        category: product.category as InventoryCategory,
        alias: raw.alias,
        formatLabel: format.label,
        formatKind: format.kind as FormatKind,
        sourceRef:
          /^https:\/\/world[.]openfoodfacts[.]org\/product\/[0-9]{8,14}$/.test(
            product.source_ref ?? '',
          )
            ? product.source_ref
            : null,
        formatSizeUnit: format.size_unit,
        entries: (raw.stock_entries ?? []).map(normalizeEntry),
      },
    ]
  })
}

export type CatalogFormat = {
  id: string
  label: string
  kind: FormatKind
  barcode: string | null
  size_quantity: string | null
  size_unit: string | null
  attachedHomeProductId: string | null
}

export type CatalogProduct = {
  id: string
  name: string
  brand: string | null
  category: InventoryCategory
  formats: CatalogFormat[]
}

export async function searchCatalog(
  homeId: string,
  query: string,
): Promise<CatalogProduct[]> {
  const term = query.trim()
  if (term.length < 2) return []
  const { data, error } = await client()
    .from('products')
    .select(
      'id, name, brand, category, product_formats(id, label, kind, barcode, size_quantity, size_unit)',
    )
    .or(`scope_home_id.is.null,scope_home_id.eq.${homeId}`)
    .ilike('name', `%${term}%`)
    .order('name')
    .limit(24)
  raise(error)
  const products = (data ?? []) as unknown as Array<{
    id: string
    name: string
    brand: string | null
    category: InventoryCategory
    product_formats: Array<Omit<CatalogFormat, 'attachedHomeProductId'>>
  }>
  const formatIds = products.flatMap((product) =>
    product.product_formats.map((format) => format.id),
  )
  if (!formatIds.length) return []
  const { data: attached, error: attachedError } = await client()
    .from('home_products')
    .select('id, format_id')
    .eq('home_id', homeId)
    .in('format_id', formatIds)
  raise(attachedError)
  const homeProductByFormat = new Map(
    (attached ?? []).map((row: { id: string; format_id: string }) => [
      row.format_id,
      row.id,
    ]),
  )
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    formats: product.product_formats.map((format) => ({
      ...format,
      size_quantity:
        format.size_quantity === null ? null : String(format.size_quantity),
      attachedHomeProductId: homeProductByFormat.get(format.id) ?? null,
    })),
  }))
}

export type MovementRequest = {
  p_kind: 'purchase' | 'consume' | 'correction' | 'open' | 'move' | 'discard'
  p_entry_id?: string | null
  p_home_product_id?: string | null
  p_state?: InventoryState | Record<string, string | number | null> | null
  p_amount?: string | null
  p_location_id?: string | null
  p_expected_version?: number | null
  p_note?: string | null
  p_unit?: StockUnit | null
}

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

const memoryKeys = new Map<string, string>()

function movementKey(homeId: string, request: MovementRequest): string {
  const fingerprint = JSON.stringify(request)
  const storageKey = `casetta:inventory-request:${homeId}:${fingerprint}`
  try {
    const existing = sessionStorage.getItem(storageKey)
    if (existing) return existing
    const key = uuid()
    sessionStorage.setItem(storageKey, key)
    return key
  } catch {
    const existing = memoryKeys.get(storageKey)
    if (existing) return existing
    const key = uuid()
    memoryKeys.set(storageKey, key)
    return key
  }
}

function clearMovementKey(homeId: string, request: MovementRequest) {
  const storageKey = `casetta:inventory-request:${homeId}:${JSON.stringify(request)}`
  try {
    sessionStorage.removeItem(storageKey)
  } catch {
    memoryKeys.delete(storageKey)
  }
}

export async function recordMovement(
  homeId: string,
  request: MovementRequest,
): Promise<string> {
  const key = movementKey(homeId, request)
  const { data, error } = await client().rpc('record_stock_movement', {
    p_home_id: homeId,
    p_key: key,
    p_kind: request.p_kind,
    p_entry_id: request.p_entry_id ?? null,
    p_home_product_id: request.p_home_product_id ?? null,
    p_state: request.p_state ?? null,
    p_amount: request.p_amount ?? null,
    p_location_id: request.p_location_id ?? null,
    p_expected_version: request.p_expected_version ?? null,
    p_note: request.p_note ?? null,
    p_unit: request.p_unit ?? null,
  })
  raise(error)
  if (typeof data !== 'string')
    throw new Error('Supabase non ha restituito il movimento registrato.')
  clearMovementKey(homeId, request)
  return data
}

const additionMemory = new Map<string, string>()
const additionStore = {
  getItem(key: string) {
    try {
      return sessionStorage.getItem(key) ?? additionMemory.get(key) ?? null
    } catch {
      return additionMemory.get(key) ?? null
    }
  },
  setItem(key: string, value: string) {
    additionMemory.set(key, value)
    try {
      sessionStorage.setItem(key, value)
    } catch {
      /* storage privato indisponibile */
    }
  },
  removeItem(key: string) {
    additionMemory.delete(key)
    try {
      sessionStorage.removeItem(key)
    } catch {
      /* fallback in memoria */
    }
  },
}
async function addAtomically(homeId: string, request: AdditionRequest) {
  const { data: sessionData, error } = await client().auth.getSession()
  if (error) throw error
  if (!sessionData.session)
    throw new Error('Accedi nuovamente per aggiungere un prodotto.')
  return atomicAddition(
    async (args) => {
      const { data, error: rpcError } = await client().rpc(
        'add_inventory_product',
        args,
      )
      raise(rpcError)
      return data
    },
    additionStore,
    uuid,
    sessionData.session.user.id,
    homeId,
    request,
  )
}

export async function attachCatalogFormat(
  homeId: string,
  formatId: string,
): Promise<{ homeProductId: string; created: boolean }> {
  const result = await addAtomically(homeId, {
    p_format_id: formatId,
    p_product: null,
    p_initial_state: {
      mode: 'unknown',
      certainty: 'unknown',
      package_state: 'unspecified',
    },
  })
  return { homeProductId: result.home_product_id, created: result.created }
}

export type CreateProductInput = {
  name: string
  brand: string
  category: InventoryCategory
  kind: FormatKind
  formatLabel: string
  barcode: string
  sizeQuantity: string
  sizeUnit: string
  initialState: InventoryState
  sourceRef?: string
}

export async function createHomeProduct(
  homeId: string,
  input: CreateProductInput,
): Promise<string> {
  const result = await addAtomically(homeId, {
    p_format_id: null,
    p_product: {
      ...(input.sourceRef
        ? { source: 'external', source_ref: input.sourceRef }
        : {}),
      name: input.name.trim(),
      brand: input.brand.trim() || null,
      category: input.category,
      label: input.formatLabel.trim(),
      kind: input.kind,
      barcode: input.barcode.trim() || null,
      size_quantity: input.sizeQuantity.trim().replace(',', '.') || null,
      size_unit: input.sizeUnit || null,
    },
    p_initial_state: input.initialState,
  })
  return result.home_product_id
}

export type StorageLocation = { id: string; name: string }

export async function loadLocations(
  homeId: string,
): Promise<StorageLocation[]> {
  const { data, error } = await client()
    .from('storage_locations')
    .select('id, name')
    .eq('home_id', homeId)
    .order('name')
  raise(error)
  return (data ?? []) as StorageLocation[]
}

export async function createLocation(
  homeId: string,
  name: string,
): Promise<StorageLocation> {
  const { data, error } = await client()
    .from('storage_locations')
    .insert({ home_id: homeId, name: name.trim() })
    .select('id, name')
    .single()
  raise(error)
  if (!data) throw new Error('Supabase non ha restituito la posizione creata.')
  return data as StorageLocation
}

export function inventoryErrorMessage(error: unknown): string {
  if (!(error instanceof Error))
    return 'Errore imprevisto durante l’operazione.'
  const code = error instanceof InventoryError ? error.code : undefined
  if (code === '42501')
    return 'Non hai più i permessi per modificare le scorte di questa abitazione.'
  if (code === '40001')
    return 'La scorta è cambiata mentre la modificavi. Aggiorno i dati: controlla e ripeti.'
  if (code === '23514')
    return 'La quantità o l’operazione non è compatibile con la disponibilità registrata.'
  if (code === '22023') return `Operazione non valida: ${error.message}`
  if (code === '23505') return 'Questo prodotto è già presente nell’abitazione.'
  if (
    error instanceof TypeError ||
    /fetch|network|timeout/i.test(error.message)
  )
    return 'Connessione interrotta. Controlla le scorte prima di riprovare: la richiesta potrebbe essere arrivata al database.'
  return `Operazione non riuscita: ${error.message}`
}

export type BarcodeMatch = {
  id: string
  label: string
  products: { name: string; brand: string | null }
}

export async function findBarcodeFormats(
  homeId: string,
  codes: string[],
): Promise<BarcodeMatch[]> {
  const { data, error } = await client()
    .from('product_formats')
    .select('id, label, products!inner(name, brand, scope_home_id)')
    .in('barcode', codes)
    .or(`scope_home_id.is.null,scope_home_id.eq.${homeId}`, {
      referencedTable: 'products',
    })
  raise(error)
  return (data ?? []) as unknown as BarcodeMatch[]
}
