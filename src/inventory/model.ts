export type InventoryCategory = 'food' | 'household' | 'other'
export type StockMode = 'count' | 'measure' | 'level' | 'unknown'
export type StockUnit = 'pack' | 'piece' | 'g' | 'kg' | 'ml' | 'l'
export type StockLevel = 'available' | 'low' | 'empty'
export type StockCertainty = 'confirmed' | 'estimated' | 'unknown'
export type PackageState = 'sealed' | 'open' | 'unspecified'
export type FormatKind = 'packaged' | 'loose' | 'piece'

export type StockEntry = {
  id: string
  mode: StockMode
  quantity: string | null
  unit: StockUnit | null
  level: StockLevel | null
  certainty: StockCertainty
  package_state: PackageState
  package_count: number | null
  location_id: string | null
  expires_on: string | null
  version: number
  location: { id: string; name: string } | null
}

export type InventoryProduct = {
  id: string
  formatId: string
  name: string
  brand: string | null
  category: InventoryCategory
  alias: string | null
  formatLabel: string
  formatKind: FormatKind
  formatSizeUnit: string | null
  entries: StockEntry[]
}

export type InventoryState = {
  mode: StockMode
  quantity: string | null
  unit: StockUnit | null
  level: StockLevel | null
  certainty: StockCertainty
  package_state: PackageState
  package_count: number | null
  location_id: string | null
  expires_on: string | null
}

export type AvailabilityFilter = 'all' | 'available' | 'low' | 'empty' | 'check'

export function validateQuantity(
  value: string,
  whole: boolean,
  allowZero = true,
): string | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalized)) return null
  if (whole && normalized.includes('.')) return null
  if (normalized.length > 18) return null
  const integer = normalized.split('.')[0] ?? '0'
  if (
    integer.length > 12 ||
    (integer.length === 12 && integer >= '1000000000000')
  )
    return null
  const canonical =
    `${integer}${normalized.includes('.') ? `.${normalized.split('.')[1]?.replace(/0+$/, '') ?? ''}` : ''}`.replace(
      /\.$/,
      '',
    )
  if (!allowZero && !/[1-9]/.test(canonical)) return null
  return canonical
}

export function formatQuantity(value: string): string {
  return value.replace('.', ',')
}

export function stateLabel(entry: StockEntry): string {
  if (entry.mode === 'unknown') return 'Da verificare'
  if (entry.mode === 'level') {
    return entry.level === 'available'
      ? 'Disponibile'
      : entry.level === 'low'
        ? 'Quasi finito'
        : 'Finito'
  }
  if (entry.quantity === '0') return 'Finito · zero confermato'
  return `${formatQuantity(entry.quantity ?? '')} ${unitLabel(entry.unit)}`
}

export function unitLabel(unit: StockUnit | null): string {
  switch (unit) {
    case 'pack':
      return 'confezioni'
    case 'piece':
      return 'pezzi'
    case 'g':
      return 'g'
    case 'kg':
      return 'kg'
    case 'ml':
      return 'ml'
    case 'l':
      return 'l'
    default:
      return ''
  }
}

export function certaintyLabel(certainty: StockCertainty): string {
  return certainty === 'confirmed'
    ? 'Confermato'
    : certainty === 'estimated'
      ? 'Stimato'
      : 'Sconosciuto'
}

export function isDefinitivelyEmpty(entry: StockEntry): boolean {
  return (
    (entry.mode === 'level' &&
      entry.level === 'empty' &&
      entry.certainty === 'confirmed') ||
    ((entry.mode === 'count' || entry.mode === 'measure') &&
      entry.quantity === '0' &&
      entry.certainty === 'confirmed')
  )
}

export function matchesAvailability(
  entries: StockEntry[],
  filter: AvailabilityFilter,
): boolean {
  if (filter === 'all') return true
  if (filter === 'available')
    return entries.some(
      (entry) =>
        (entry.mode === 'level' && entry.level === 'available') ||
        ((entry.mode === 'count' || entry.mode === 'measure') &&
          entry.quantity !== null &&
          entry.quantity !== '0'),
    )
  if (filter === 'low')
    return entries.some(
      (entry) => entry.mode === 'level' && entry.level === 'low',
    )
  if (filter === 'empty')
    return entries.length > 0 && entries.every(isDefinitivelyEmpty)
  return (
    entries.length === 0 ||
    entries.some((entry) => entry.certainty !== 'confirmed')
  )
}

export function filterProducts(
  products: InventoryProduct[],
  search: string,
  category: InventoryCategory | 'all',
  availability: AvailabilityFilter,
): InventoryProduct[] {
  const query = search.trim().toLocaleLowerCase('it-IT')
  return products.filter((product) => {
    const searchable =
      `${product.name} ${product.brand ?? ''} ${product.alias ?? ''} ${product.formatLabel}`.toLocaleLowerCase(
        'it-IT',
      )
    return (
      (!query || searchable.includes(query)) &&
      (category === 'all' || product.category === category) &&
      matchesAvailability(product.entries, availability)
    )
  })
}

export function newUnknownState(): InventoryState {
  return {
    mode: 'unknown',
    quantity: null,
    unit: null,
    level: null,
    certainty: 'unknown',
    package_state: 'unspecified',
    package_count: null,
    location_id: null,
    expires_on: null,
  }
}

export function newCountState(
  quantity: string,
  unit: 'pack' | 'piece',
  packageState: PackageState,
  certainty: 'confirmed' | 'estimated' = 'confirmed',
): InventoryState {
  return {
    ...newUnknownState(),
    mode: 'count',
    quantity,
    unit,
    certainty,
    package_state: unit === 'pack' ? packageState : 'unspecified',
  }
}

export function newMeasureState(
  quantity: string,
  unit: 'g' | 'kg' | 'ml' | 'l',
  certainty: 'confirmed' | 'estimated',
): InventoryState {
  return {
    ...newUnknownState(),
    mode: 'measure',
    quantity,
    unit,
    certainty,
  }
}

export function newLevelState(
  level: StockLevel,
  certainty: 'confirmed' | 'estimated',
  packageState: PackageState,
): InventoryState {
  return {
    ...newUnknownState(),
    mode: 'level',
    level,
    certainty,
    package_state: packageState,
  }
}
