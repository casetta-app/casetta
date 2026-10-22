import { BarcodeScanner } from '../scanner/BarcodeScanner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHomes } from '../homes/HomeContext'
import { Icon } from '../components/Icon'
import {
  attachCatalogFormat,
  createHomeProduct,
  createLocation,
  InventoryError,
  inventoryErrorMessage,
  loadInventory,
  loadLocations,
  recordMovement,
  searchCatalog,
  type CatalogProduct,
  type CreateProductInput,
  type MovementRequest,
  type StorageLocation,
} from '../inventory/api'
import {
  filterProducts,
  newCountState,
  newLevelState,
  newMeasureState,
  newUnknownState,
  productAvailabilitySummary,
  isDefinitivelyEmpty,
  sortEntriesForDisplay,
  stateLabel,
  unitLabel,
  validateQuantity,
  type AvailabilityFilter,
  type FormatKind,
  type InventoryCategory,
  type InventoryProduct,
  type InventoryState,
  type PackageState,
  type StockEntry,
  type StockLevel,
  type StockMode,
  type StockUnit,
} from '../inventory/model'

type EditorAction = 'add' | 'consume' | 'correct' | 'open' | 'location'

const categoryLabels: Record<InventoryCategory, string> = {
  food: 'Alimentari',
  household: 'Casa',
  other: 'Altro',
}

function certaintyText(value: StockEntry['certainty']) {
  return value === 'confirmed'
    ? 'Confermato'
    : value === 'estimated'
      ? 'Stimato'
      : 'Sconosciuto'
}

function compatibleMeasure(formatUnit: string | null, stockUnit: StockUnit) {
  if (!formatUnit) return true
  const mass = ['g', 'kg'].includes(formatUnit)
  const volume = ['ml', 'l'].includes(formatUnit)
  return (
    (mass && ['g', 'kg'].includes(stockUnit)) ||
    (volume && ['ml', 'l'].includes(stockUnit))
  )
}

function packageText(entry: StockEntry) {
  if (entry.package_state === 'sealed') return 'Confezioni chiuse'
  if (entry.package_state === 'open') {
    return entry.package_count === null
      ? 'Confezione aperta'
      : `${entry.package_count} ${entry.package_count === 1 ? 'confezione aperta' : 'confezioni aperte'}`
  }
  return ''
}

function stockStateForNewProduct(form: {
  availability: string
  quantity: string
  unit: StockUnit
  certainty: 'confirmed' | 'estimated'
  level: StockLevel
  packageState: PackageState
  kind: FormatKind
}): InventoryState | null {
  if (form.availability === 'unknown') return newUnknownState()
  if (form.availability === 'level')
    return newLevelState(
      form.level,
      form.certainty,
      form.kind === 'packaged' ? form.packageState : 'unspecified',
    )
  const quantity = validateQuantity(
    form.quantity,
    form.availability === 'count',
  )
  if (!quantity) return null
  if (form.availability === 'count') {
    if (form.unit !== 'pack' && form.unit !== 'piece') return null
    return newCountState(
      quantity,
      form.unit,
      form.kind === 'packaged' ? form.packageState : 'unspecified',
      form.certainty,
    )
  }
  if (form.unit === 'pack' || form.unit === 'piece') return null
  return newMeasureState(quantity, form.unit, form.certainty)
}

export function StockPage() {
  const { activeHome } = useHomes()
  const home = activeHome!
  const writable = home.access.role === 'owner' || home.access.role === 'editor'
  const [products, setProducts] = useState<InventoryProduct[]>([])
  const [loadedHomeId, setLoadedHomeId] = useState('')
  const [locations, setLocations] = useState<StorageLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<InventoryCategory | 'all'>('all')
  const [availability, setAvailability] = useState<AvailabilityFilter>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const productDetails = useRef<HTMLDetailsElement>(null)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [editor, setEditor] = useState<{
    productId: string
    entryId: string | null
    action: EditorAction
  } | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [newBrand, setNewBrand] = useState('')
  const [newCategory, setNewCategory] = useState<InventoryCategory>('food')
  const [newKind, setNewKind] = useState<FormatKind>('packaged')
  const [formatLabel, setFormatLabel] = useState('')
  const [barcode, setBarcode] = useState('')
  const [sizeQuantity, setSizeQuantity] = useState('')
  const [sizeUnit, setSizeUnit] = useState('')
  const [newAvailability, setNewAvailability] = useState('unknown')
  const [newQuantity, setNewQuantity] = useState('1')
  const [newUnit, setNewUnit] = useState<StockUnit>('pack')
  const [newCertainty, setNewCertainty] = useState<'confirmed' | 'estimated'>(
    'confirmed',
  )
  const [newLevel, setNewLevel] = useState<StockLevel>('available')
  const [newPackageState, setNewPackageState] = useState<PackageState>('sealed')
  const [operationQuantity, setOperationQuantity] = useState('1')
  const [correctionMode, setCorrectionMode] = useState<StockMode>('unknown')
  const [correctionQuantity, setCorrectionQuantity] = useState('1')
  const [correctionUnit, setCorrectionUnit] = useState<StockUnit>('pack')
  const [correctionLevel, setCorrectionLevel] =
    useState<StockLevel>('available')
  const [correctionCertainty, setCorrectionCertainty] = useState<
    'confirmed' | 'estimated'
  >('confirmed')
  const [correctionPackage, setCorrectionPackage] =
    useState<PackageState>('unspecified')
  const [targetLocation, setTargetLocation] = useState('')
  const [newLocationName, setNewLocationName] = useState('')
  const requestSequence = useRef(0)
  const catalogSequence = useRef(0)
  const busyRef = useRef(false)
  const locationBusyRef = useRef(false)

  const reload = useCallback(async () => {
    const request = ++requestSequence.current
    setLoading(true)
    setLoadError('')
    setProducts([])
    setLoadedHomeId('')
    try {
      const [nextProducts, nextLocations] = await Promise.all([
        loadInventory(home.id),
        loadLocations(home.id),
      ])
      if (request !== requestSequence.current) return
      setProducts(nextProducts)
      setLoadedHomeId(home.id)
      setLocations(nextLocations)
    } catch (caught) {
      if (request !== requestSequence.current) return
      setLoadError(inventoryErrorMessage(caught))
      setProducts([])
      setLoadedHomeId(home.id)
    } finally {
      if (request === requestSequence.current) setLoading(false)
    }
  }, [home.id])

  useEffect(() => {
    setEditor(null)
    setShowAdd(false)
    setShowScanner(false)
    setNotice('')
    void reload()
    return () => {
      requestSequence.current += 1
    }
  }, [reload])

  useEffect(() => {
    const request = ++catalogSequence.current
    if (!showAdd || catalogQuery.trim().length < 2) {
      setCatalog([])
      setCatalogBusy(false)
      setCatalogError('')
      return
    }
    const timeout = window.setTimeout(() => {
      setCatalogBusy(true)
      setCatalogError('')
      void searchCatalog(home.id, catalogQuery)
        .then((result) => {
          if (request === catalogSequence.current) setCatalog(result)
        })
        .catch((caught: unknown) => {
          if (request === catalogSequence.current)
            setCatalogError(inventoryErrorMessage(caught))
        })
        .finally(() => {
          if (request === catalogSequence.current) setCatalogBusy(false)
        })
    }, 180)
    return () => window.clearTimeout(timeout)
  }, [catalogQuery, home.id, showAdd])

  const homeProducts = useMemo(
    () => (loadedHomeId === home.id ? products : []),
    [loadedHomeId, home.id, products],
  )
  const homeLoading = loading || loadedHomeId !== home.id
  const homeLoadError = loadedHomeId === home.id ? loadError : ''
  const visibleProducts = useMemo(
    () => filterProducts(homeProducts, search, category, availability),
    [homeProducts, search, category, availability],
  )

  function openEditor(
    product: InventoryProduct,
    entry: StockEntry | null,
    action: EditorAction,
  ) {
    setError('')
    setEditor({ productId: product.id, entryId: entry?.id ?? null, action })
    setOperationQuantity('1')
    setCorrectionMode(entry?.mode ?? 'unknown')
    setCorrectionQuantity(entry?.quantity ?? '1')
    setCorrectionUnit(
      entry?.unit ?? (product.formatKind === 'piece' ? 'piece' : 'pack'),
    )
    setCorrectionLevel(
      action === 'consume' && entry?.mode === 'level'
        ? entry.level === 'available'
          ? 'low'
          : 'empty'
        : (entry?.level ?? 'available'),
    )
    setCorrectionCertainty(
      entry?.certainty === 'estimated' ? 'estimated' : 'confirmed',
    )
    setCorrectionPackage(entry?.package_state ?? 'unspecified')
    if (
      action === 'add' &&
      (!entry ||
        !['count', 'measure'].includes(entry.mode) ||
        entry.certainty !== 'confirmed')
    ) {
      setCorrectionMode('count')
      setCorrectionQuantity('1')
      setCorrectionUnit(product.formatKind === 'packaged' ? 'pack' : 'piece')
      setCorrectionCertainty('confirmed')
      setCorrectionLevel('available')
    }
    setTargetLocation(entry?.location_id ?? '')
    setNewLocationName('')
  }

  function changeCorrectionMode(product: InventoryProduct, mode: StockMode) {
    setCorrectionMode(mode)
    if (mode === 'count')
      setCorrectionUnit(product.formatKind === 'packaged' ? 'pack' : 'piece')
    if (mode === 'measure') {
      setCorrectionUnit(
        ['ml', 'l'].includes(product.formatSizeUnit ?? '')
          ? 'ml'
          : ['g', 'kg'].includes(product.formatSizeUnit ?? '')
            ? 'kg'
            : 'kg',
      )
    }
    if (mode === 'level' && product.formatKind === 'packaged')
      setCorrectionPackage('open')
  }

  async function performMovement(
    productId: string,
    entryId: string | null,
    request: MovementRequest,
    successMessage: string,
  ) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(productId)
    setError('')
    setNotice('')
    try {
      await recordMovement(home.id, {
        ...request,
        p_entry_id: entryId,
      })
      setNotice(successMessage)
      setEditor(null)
      await reload()
    } catch (caught) {
      setError(inventoryErrorMessage(caught))
      const uncertain =
        caught instanceof Error && /fetch|network|timeout/i.test(caught.message)
      if (
        (caught instanceof InventoryError && caught.code === '40001') ||
        uncertain
      ) {
        setEditor(null)
        await reload()
      }
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  async function saveCorrection(
    product: InventoryProduct,
    entry: StockEntry | null,
  ) {
    const quantity =
      correctionMode === 'count' || correctionMode === 'measure'
        ? validateQuantity(correctionQuantity, correctionMode === 'count')
        : null
    if (
      (correctionMode === 'count' || correctionMode === 'measure') &&
      !quantity
    ) {
      setError(
        'Inserisci una quantità valida. Usa al massimo sei decimali; i pezzi e le confezioni devono essere interi.',
      )
      return
    }
    if (
      correctionMode === 'count' &&
      correctionUnit !== 'pack' &&
      correctionUnit !== 'piece'
    ) {
      setError('Per quantità contate scegli confezioni o pezzi.')
      return
    }
    if (
      correctionMode === 'measure' &&
      ['pack', 'piece'].includes(correctionUnit)
    ) {
      setError('Per una quantità misurata scegli g, kg, ml o l.')
      return
    }
    if (
      correctionMode === 'measure' &&
      !compatibleMeasure(product.formatSizeUnit, correctionUnit)
    ) {
      setError(
        `Il formato è espresso in ${product.formatSizeUnit}; scegli un’unità della stessa dimensione.`,
      )
      return
    }
    if (!entry) {
      const state =
        correctionMode === 'unknown'
          ? newUnknownState()
          : correctionMode === 'level'
            ? newLevelState(
                correctionLevel,
                correctionCertainty,
                correctionPackage,
              )
            : correctionMode === 'count'
              ? newCountState(
                  quantity!,
                  correctionUnit as 'pack' | 'piece',
                  correctionPackage,
                  correctionCertainty,
                )
              : newMeasureState(
                  quantity!,
                  correctionUnit as 'g' | 'kg' | 'ml' | 'l',
                  correctionCertainty,
                )
      state.location_id = targetLocation || null
      await performMovement(
        product.id,
        null,
        {
          p_kind: 'correction',
          p_home_product_id: product.id,
          p_state: state,
        },
        'Disponibilità registrata.',
      )
      return
    }
    const state: InventoryState =
      correctionMode === 'unknown'
        ? newUnknownState()
        : correctionMode === 'level'
          ? newLevelState(
              correctionLevel,
              correctionCertainty,
              correctionPackage,
            )
          : correctionMode === 'count'
            ? newCountState(
                quantity!,
                correctionUnit as 'pack' | 'piece',
                correctionPackage,
                correctionCertainty,
              )
            : newMeasureState(
                quantity!,
                correctionUnit as 'g' | 'kg' | 'ml' | 'l',
                correctionCertainty,
              )
    state.location_id = targetLocation || null
    state.expires_on = entry.expires_on
    await performMovement(
      product.id,
      entry.id,
      {
        p_kind: 'correction',
        p_expected_version: entry.version,
        p_state: state,
      },
      'Disponibilità corretta.',
    )
  }

  async function submitAdd(input: CreateProductInput) {
    if (!input.name.trim()) {
      setError('Scrivi il nome del prodotto.')
      return
    }
    const name =
      input.formatLabel.trim() ||
      (input.kind === 'packaged'
        ? 'Confezione'
        : input.kind === 'piece'
          ? 'Pezzo'
          : 'Sfuso')
    if (!input.sizeQuantity.trim() && input.sizeUnit) {
      setError(
        'Inserisci anche la quantità del formato oppure lascia vuota l’unità.',
      )
      return
    }
    if (
      input.sizeQuantity.trim() &&
      !validateQuantity(input.sizeQuantity, input.sizeUnit === 'piece', false)
    ) {
      setError(
        'La quantità del formato deve essere positiva e avere al massimo sei decimali.',
      )
      return
    }
    if (input.sizeQuantity.trim() && !input.sizeUnit) {
      setError('Scegli anche l’unità della quantità del formato.')
      return
    }
    if (
      input.initialState.mode === 'measure' &&
      !compatibleMeasure(input.sizeUnit || null, input.initialState.unit!)
    ) {
      setError(
        `La quantità iniziale deve usare un’unità compatibile con il formato (${input.sizeUnit}).`,
      )
      return
    }
    if (busyRef.current) return
    busyRef.current = true
    setBusy('new-product')
    setError('')
    setNotice('')
    try {
      await createHomeProduct(home.id, { ...input, formatLabel: name })
      setNotice(`${input.name.trim()} aggiunto alle scorte.`)
      setShowAdd(false)
      setNewName('')
      setCatalogQuery('')
      await reload()
    } catch (caught) {
      setError(inventoryErrorMessage(caught))
      await reload()
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  async function chooseCatalogFormat(formatId: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy('catalog')
    setError('')
    setCatalogError('')
    try {
      const result = await attachCatalogFormat(home.id, formatId)
      setNotice(
        result.created
          ? 'Prodotto aggiunto con disponibilità da verificare.'
          : 'Questo formato è già presente nelle scorte.',
      )
      if (result.created) setShowAdd(false)
      await reload()
    } catch (caught) {
      setError(inventoryErrorMessage(caught))
      await reload()
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  async function saveLocation(
    product: InventoryProduct,
    entry: StockEntry | null,
  ) {
    if (locationBusyRef.current || busyRef.current) return
    if (!entry) {
      setError(
        'Registra prima una disponibilità, poi potrai assegnarle una posizione.',
      )
      return
    }
    let locationId = targetLocation || null
    if (newLocationName.trim()) {
      locationBusyRef.current = true
      try {
        const location = await createLocation(home.id, newLocationName)
        locationId = location.id
        setLocations((current) =>
          [...current, location].sort((a, b) =>
            a.name.localeCompare(b.name, 'it'),
          ),
        )
        setTargetLocation(location.id)
        setNewLocationName('')
      } catch (caught) {
        setError(inventoryErrorMessage(caught))
        return
      } finally {
        locationBusyRef.current = false
      }
    }
    await performMovement(
      product.id,
      entry.id,
      {
        p_kind: 'move',
        p_location_id: locationId,
      },
      locationId ? 'Posizione aggiornata.' : 'Posizione rimossa.',
    )
  }

  const createInput = (): CreateProductInput | null => {
    const state = stockStateForNewProduct({
      availability: newAvailability,
      quantity: newQuantity,
      unit: newUnit,
      certainty: newCertainty,
      level: newLevel,
      packageState: newPackageState,
      kind: newKind,
    })
    if (!state) {
      setError(
        'Controlla quantità e unità: confezioni e pezzi sono interi, le misure ammettono fino a sei decimali.',
      )
      return null
    }
    if (
      barcode.trim() &&
      !/^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$/.test(barcode.trim())
    ) {
      setError(
        'Il codice deve contenere 8, 12, 13 o 14 cifre. Puoi lasciarlo vuoto.',
      )
      return null
    }
    return {
      name: newName,
      brand: newBrand,
      category: newCategory,
      kind: newKind,
      formatLabel,
      barcode,
      sizeQuantity,
      sizeUnit,
      initialState: state,
    }
  }

  return (
    <section className="page stock-page" aria-labelledby="stock-title">
      <div className="stock-heading">
        <div>
          <p className="eyebrow page-kicker">
            CASETTA · {home.name.toLocaleUpperCase('it-IT')}
          </p>
          <h1 id="stock-title">Scorte</h1>
          <p className="page-subtitle">
            Tieni traccia di ciò che c’è, anche senza contare tutto.
          </p>
        </div>
        {writable && (
          <button
            className="primary-button add-product-button"
            type="button"
            onClick={() => {
              setShowAdd((value) => !value)
              setError('')
              setNotice('')
            }}
          >
            <span aria-hidden="true">+</span> Aggiungi
          </button>
        )}
      </div>

      {notice && (
        <p className="inventory-feedback success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="inventory-feedback failure" role="alert">
          {error}
        </p>
      )}

      {showAdd && writable && (
        <section
          className="inventory-panel add-panel"
          aria-labelledby="add-title"
        >
          <div className="panel-heading">
            <div>
              <span className="soft-label">
                POCHI CAMPI, DISPONIBILITÀ FACOLTATIVA
              </span>
              <h2 id="add-title">Aggiungi alle scorte</h2>
            </div>
            <button
              className="quiet-button"
              type="button"
              onClick={() => setShowAdd(false)}
            >
              Chiudi
            </button>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowScanner(true)}
          >
            Scansiona
          </button>
          {showScanner && (
            <BarcodeScanner
              key={home.id}
              homeId={home.id}
              onClose={() => setShowScanner(false)}
              onAdded={reload}
              onManual={(code) => {
                setBarcode(code)
                setNewName('')
                setNewBrand('')
                setFormatLabel('')
                setSizeQuantity('')
                setSizeUnit('')
                setNewAvailability('unknown')
                setShowScanner(false)
                if (productDetails.current) productDetails.current.open = true
              }}
            />
          )}
          <label className="field-label">
            Cerca nel catalogo
            <input
              value={catalogQuery}
              onChange={(event) => setCatalogQuery(event.target.value)}
              placeholder="Es. pasta, detersivo…"
              autoComplete="off"
            />
          </label>
          {catalogBusy && (
            <p className="inline-note" role="status">
              Cerco nel catalogo…
            </p>
          )}
          {catalogError && (
            <p className="inventory-feedback failure" role="alert">
              {catalogError}
            </p>
          )}
          {catalog.length > 0 && (
            <ul className="catalog-results">
              {catalog.map((item) => (
                <li key={item.id}>
                  <div className="catalog-product-copy">
                    <strong>{item.name}</strong>
                    <span>{item.brand || categoryLabels[item.category]}</span>
                  </div>
                  <div className="catalog-formats">
                    {item.formats.map((format) => (
                      <button
                        key={format.id}
                        type="button"
                        className="format-choice"
                        disabled={
                          Boolean(format.attachedHomeProductId) || Boolean(busy)
                        }
                        onClick={() => void chooseCatalogFormat(format.id)}
                      >
                        {format.label}
                        {format.attachedHomeProductId
                          ? ' · Già nelle scorte'
                          : ' · Aggiungi'}
                      </button>
                    ))}
                    {!item.formats.length && (
                      <span className="inline-note">
                        Nessun formato disponibile.
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {catalogQuery.trim().length >= 2 &&
            !catalogBusy &&
            !catalogError &&
            !catalog.length && (
              <p className="inline-note">
                Nessun risultato nel catalogo. Puoi inserirlo qui sotto.
              </p>
            )}

          <form
            className="new-product-form"
            onSubmit={(event) => {
              event.preventDefault()
              const input = createInput()
              if (input) void submitAdd(input)
            }}
          >
            <h3>Nuovo prodotto</h3>
            <div className="form-grid essential-product-fields">
              <label className="field-label">
                Nome <span className="required-mark">obbligatorio</span>
                <input
                  required
                  maxLength={160}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Es. Pasta"
                />
              </label>
              <label className="field-label">
                Disponibilità
                <select
                  value={newAvailability}
                  onChange={(event) => {
                    const value = event.target.value
                    setNewAvailability(value)
                    if (value === 'count')
                      setNewUnit(newKind === 'packaged' ? 'pack' : 'piece')
                    if (value === 'measure')
                      setNewUnit(
                        sizeUnit === 'g' || sizeUnit === 'kg'
                          ? 'kg'
                          : sizeUnit === 'ml' || sizeUnit === 'l'
                            ? 'ml'
                            : 'kg',
                      )
                    if (value === 'level')
                      setNewPackageState(
                        newKind === 'packaged' ? 'open' : 'unspecified',
                      )
                  }}
                >
                  <option value="unknown">Da verificare</option>
                  <option value="count">Quantità contata</option>
                  <option value="measure">Quantità misurata</option>
                  <option value="level">Indicativa</option>
                </select>
              </label>
            </div>
            <details
              ref={productDetails}
              className="additional-product-details"
            >
              <summary>
                Altri dettagli <span>Facoltativi</span>
              </summary>
              <div className="form-grid">
                <label className="field-label">
                  Marca <span className="optional-mark">facoltativa</span>
                  <input
                    maxLength={120}
                    value={newBrand}
                    onChange={(event) => setNewBrand(event.target.value)}
                    placeholder="Se la ricordi"
                  />
                </label>
                <label className="field-label">
                  Tipo
                  <select
                    value={newKind}
                    onChange={(event) => {
                      const kind = event.target.value as FormatKind
                      setNewKind(kind)
                      if (newAvailability === 'count')
                        setNewUnit(kind === 'packaged' ? 'pack' : 'piece')
                      else if (kind === 'piece') setNewUnit('piece')
                      else if (kind === 'packaged') setNewUnit('pack')
                      else if (newUnit === 'pack' || newUnit === 'piece')
                        setNewUnit('kg')
                    }}
                  >
                    <option value="packaged">Confezionato</option>
                    <option value="loose">Sfuso</option>
                    <option value="piece">A pezzo</option>
                  </select>
                </label>
                <label className="field-label">
                  Categoria
                  <select
                    value={newCategory}
                    onChange={(event) =>
                      setNewCategory(event.target.value as InventoryCategory)
                    }
                  >
                    <option value="food">Alimentari</option>
                    <option value="household">Casa</option>
                    <option value="other">Altro</option>
                  </select>
                </label>
                <label className="field-label">
                  Formato <span className="optional-mark">facoltativo</span>
                  <input
                    maxLength={120}
                    value={formatLabel}
                    onChange={(event) => setFormatLabel(event.target.value)}
                    placeholder={
                      newKind === 'packaged'
                        ? 'Es. Pacco da 500 g'
                        : newKind === 'piece'
                          ? 'Es. Singolo'
                          : 'Es. Sfuso'
                    }
                  />
                </label>
                <label className="field-label">
                  Codice a barre{' '}
                  <span className="optional-mark">facoltativo</span>
                  <input
                    inputMode="numeric"
                    autoComplete="off"
                    value={barcode}
                    onChange={(event) =>
                      setBarcode(event.target.value.replace(/\D/g, ''))
                    }
                    placeholder="Puoi aggiungerlo dopo"
                  />
                </label>
                <label className="field-label">
                  Quantità nel formato{' '}
                  <span className="optional-mark">facoltativa</span>
                  <input
                    inputMode="decimal"
                    value={sizeQuantity}
                    onChange={(event) => setSizeQuantity(event.target.value)}
                    placeholder="Es. 500"
                  />
                </label>
                <label className="field-label">
                  Unità del formato
                  <select
                    value={sizeUnit}
                    onChange={(event) => {
                      const unit = event.target.value
                      setSizeUnit(unit)
                      if (
                        newAvailability === 'measure' &&
                        ['g', 'kg', 'ml', 'l'].includes(unit)
                      )
                        setNewUnit(unit as StockUnit)
                      if (newAvailability === 'level' && newKind === 'packaged')
                        setNewPackageState('open')
                    }}
                  >
                    <option value="">Nessuna</option>
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                    <option value="ml">ml</option>
                    <option value="l">l</option>
                    <option value="piece">pezzi</option>
                  </select>
                </label>
              </div>
            </details>
            <div className="form-grid availability-fields">
              {newAvailability === 'count' && (
                <>
                  <label className="field-label">
                    Quantità
                    <input
                      inputMode="numeric"
                      value={newQuantity}
                      onChange={(event) => setNewQuantity(event.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    Unità
                    <select
                      value={
                        newUnit === 'piece' || newKind !== 'packaged'
                          ? 'piece'
                          : 'pack'
                      }
                      onChange={(event) =>
                        setNewUnit(event.target.value as StockUnit)
                      }
                    >
                      {newKind === 'packaged' && (
                        <option value="pack">Confezioni</option>
                      )}
                      <option value="piece">Pezzi</option>
                    </select>
                  </label>
                  {newKind === 'packaged' && (
                    <label className="field-label">
                      Confezioni
                      <select
                        value={newPackageState}
                        onChange={(event) =>
                          setNewPackageState(event.target.value as PackageState)
                        }
                      >
                        <option value="sealed">Chiuse</option>
                        <option value="open">Aperte</option>
                        <option value="unspecified">Non specificato</option>
                      </select>
                    </label>
                  )}
                  <label className="field-label">
                    Attendibilità
                    <select
                      value={newCertainty}
                      onChange={(event) =>
                        setNewCertainty(
                          event.target.value as 'confirmed' | 'estimated',
                        )
                      }
                    >
                      <option value="confirmed">Confermata</option>
                      <option value="estimated">Stimata</option>
                    </select>
                  </label>
                </>
              )}
              {newAvailability === 'measure' && (
                <>
                  <label className="field-label">
                    Quantità
                    <input
                      inputMode="decimal"
                      value={newQuantity}
                      onChange={(event) => setNewQuantity(event.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    Unità
                    <select
                      value={
                        ['g', 'kg', 'ml', 'l'].includes(newUnit)
                          ? newUnit
                          : 'kg'
                      }
                      onChange={(event) =>
                        setNewUnit(event.target.value as StockUnit)
                      }
                    >
                      <option value="g">g</option>
                      <option value="kg">kg</option>
                      <option value="ml">ml</option>
                      <option value="l">l</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Attendibilità
                    <select
                      value={newCertainty}
                      onChange={(event) =>
                        setNewCertainty(
                          event.target.value as 'confirmed' | 'estimated',
                        )
                      }
                    >
                      <option value="confirmed">Confermata</option>
                      <option value="estimated">Stimata</option>
                    </select>
                  </label>
                </>
              )}
              {newAvailability === 'level' && (
                <>
                  <label className="field-label">
                    Livello
                    <select
                      value={newLevel}
                      onChange={(event) =>
                        setNewLevel(event.target.value as StockLevel)
                      }
                    >
                      <option value="available">Disponibile</option>
                      <option value="low">Quasi finito</option>
                      <option value="empty">Finito</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Attendibilità
                    <select
                      value={newCertainty}
                      onChange={(event) =>
                        setNewCertainty(
                          event.target.value as 'confirmed' | 'estimated',
                        )
                      }
                    >
                      <option value="confirmed">Confermata</option>
                      <option value="estimated">Stimata</option>
                    </select>
                  </label>
                  {newKind === 'packaged' && (
                    <label className="field-label">
                      Confezione
                      <select
                        value={
                          newPackageState === 'sealed'
                            ? 'open'
                            : newPackageState
                        }
                        onChange={(event) =>
                          setNewPackageState(event.target.value as PackageState)
                        }
                      >
                        <option value="open">Aperta</option>
                        <option value="unspecified">Non specificata</option>
                      </select>
                    </label>
                  )}
                </>
              )}
            </div>
            <div className="form-actions">
              <span className="inline-note">
                Posizione e scadenza possono essere aggiunte dopo.
              </span>
              <button
                className="primary-button"
                type="submit"
                disabled={Boolean(busy)}
              >
                {busy === 'new-product' ? 'Salvo…' : 'Aggiungi alle scorte'}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="stock-filters">
        <label className="search-field">
          <span className="search-symbol" aria-hidden="true">
            ⌕
          </span>
          <span className="visually-hidden">Cerca nelle scorte</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca nelle scorte"
          />
          {search && (
            <button
              type="button"
              aria-label="Cancella ricerca"
              onClick={() => setSearch('')}
            >
              ×
            </button>
          )}
        </label>
        <label className="filter-label">
          Categoria
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as InventoryCategory | 'all')
            }
          >
            <option value="all">Tutte</option>
            <option value="food">Alimentari</option>
            <option value="household">Casa</option>
            <option value="other">Altro</option>
          </select>
        </label>
        <label className="filter-label">
          Disponibilità
          <select
            value={availability}
            onChange={(event) =>
              setAvailability(event.target.value as AvailabilityFilter)
            }
          >
            <option value="all">Tutte</option>
            <option value="available">Disponibile</option>
            <option value="low">Quasi finito</option>
            <option value="empty">Finito</option>
            <option value="check">Da verificare</option>
          </select>
        </label>
      </div>

      {homeLoadError && (
        <div className="inventory-empty" role="alert">
          <h2>Non riesco a caricare le scorte</h2>
          <p>{homeLoadError}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void reload()}
          >
            Riprova
          </button>
        </div>
      )}
      {homeLoading && !homeLoadError && (
        <p className="inventory-loading" role="status">
          Carico le scorte di {home.name}…
        </p>
      )}
      {!homeLoading && !homeLoadError && homeProducts.length === 0 && (
        <div className="inventory-empty">
          <span className="empty-stock-icon">
            <Icon name="boxes" size={28} />
          </span>
          <h2>La dispensa parte da qui.</h2>
          <p>
            Aggiungi un prodotto quando ti è comodo. La disponibilità può
            restare da verificare.
          </p>
          {writable && (
            <button
              className="primary-button"
              type="button"
              onClick={() => setShowAdd(true)}
            >
              Aggiungi il primo prodotto
            </button>
          )}
          {!writable && (
            <p className="inline-note">
              Hai accesso in sola lettura a questa abitazione.
            </p>
          )}
        </div>
      )}
      {!homeLoading &&
        !homeLoadError &&
        homeProducts.length > 0 &&
        visibleProducts.length === 0 && (
          <div className="inventory-empty compact-empty">
            <h2>Nessun prodotto trovato</h2>
            <p>Prova a cambiare ricerca o filtri.</p>
          </div>
        )}
      {!homeLoading && visibleProducts.length > 0 && (
        <div className="stock-list" aria-label={`Scorte di ${home.name}`}>
          {visibleProducts.map((product) => (
            <article className="stock-card" key={product.id}>
              <div className="stock-card-heading">
                <div className="stock-card-title">
                  <span className="stock-category">
                    {categoryLabels[product.category]}
                  </span>
                  <h2>{product.alias || product.name}</h2>
                  <p>
                    {product.brand ? `${product.brand} · ` : ''}
                    {product.formatLabel}
                  </p>
                </div>
                <span className={`format-badge format-${product.formatKind}`}>
                  {product.formatKind === 'packaged'
                    ? 'Confezionato'
                    : product.formatKind === 'loose'
                      ? 'Sfuso'
                      : 'A pezzo'}
                </span>
              </div>
              {product.entries.length > 0 && (
                <p
                  className={`availability-summary ${productAvailabilitySummary(product.entries).tone}`}
                >
                  <span>Disponibilità complessiva</span>
                  <strong>
                    {productAvailabilitySummary(product.entries).label}
                  </strong>
                </p>
              )}
              {product.entries.length === 0 ? (
                <>
                  <div className="stock-entry no-entry">
                    <div>
                      <strong>Da inventariare</strong>
                      <span>Non è stata registrata alcuna disponibilità.</span>
                    </div>
                    {writable && (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => openEditor(product, null, 'correct')}
                      >
                        Aggiungi disponibilità
                      </button>
                    )}
                  </div>
                  {editor?.productId === product.id &&
                    editor.entryId === null &&
                    renderEntryEditor({
                      action: editor.action,
                      entry: null,
                      product,
                      locations,
                      busy: Boolean(busy),
                      operationQuantity,
                      setOperationQuantity,
                      correctionMode,
                      setCorrectionMode,
                      correctionQuantity,
                      setCorrectionQuantity,
                      correctionUnit,
                      setCorrectionUnit,
                      correctionLevel,
                      setCorrectionLevel,
                      correctionCertainty,
                      setCorrectionCertainty,
                      correctionPackage,
                      setCorrectionPackage,
                      targetLocation,
                      setTargetLocation,
                      newLocationName,
                      setNewLocationName,
                      onCancel: () => setEditor(null),
                      onSave: () => void saveCorrection(product, null),
                      onMove: () => void saveLocation(product, null),
                      onMovement: (request, message) =>
                        void performMovement(
                          product.id,
                          null,
                          request,
                          message,
                        ),
                      onNewPurchase: (request, message) =>
                        void performMovement(
                          product.id,
                          null,
                          request,
                          message,
                        ),
                    })}
                </>
              ) : (
                <div className="stock-entries">
                  {sortEntriesForDisplay(product.entries).map((entry) => (
                    <div
                      className={`stock-entry${isDefinitivelyEmpty(entry) ? ' stock-entry-empty' : ''}`}
                      key={entry.id}
                    >
                      <div className="stock-entry-main">
                        <span className="lot-label">Singolo lotto</span>
                        <strong
                          className={
                            entry.mode === 'unknown' ? 'unknown-label' : ''
                          }
                        >
                          {stateLabel(entry)}
                        </strong>
                        <div className="stock-entry-tags">
                          <span
                            className={`certainty-tag certainty-${entry.certainty}`}
                          >
                            {certaintyText(entry.certainty)}
                          </span>
                          {packageText(entry) && (
                            <span>{packageText(entry)}</span>
                          )}
                          {entry.location && <span>{entry.location.name}</span>}
                          {entry.expires_on && (
                            <span>
                              Scade il{' '}
                              {new Intl.DateTimeFormat('it-IT').format(
                                new Date(`${entry.expires_on}T12:00:00`),
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                      {writable && (
                        <div className="entry-actions">
                          {entry.mode === 'count' &&
                            entry.certainty === 'confirmed' &&
                            entry.unit && (
                              <>
                                <button
                                  type="button"
                                  className="quick-button"
                                  disabled={Boolean(busy)}
                                  onClick={() =>
                                    void performMovement(
                                      product.id,
                                      entry.id,
                                      {
                                        p_kind: 'purchase',
                                        p_amount: '1',
                                        p_unit: entry.unit,
                                      },
                                      '+1',
                                    )
                                  }
                                >
                                  +1
                                </button>
                                {entry.quantity !== '0' && (
                                  <button
                                    type="button"
                                    className="quick-button"
                                    disabled={Boolean(busy)}
                                    onClick={() =>
                                      void performMovement(
                                        product.id,
                                        entry.id,
                                        {
                                          p_kind: 'consume',
                                          p_amount: '1',
                                          p_unit: entry.unit,
                                        },
                                        'Quantità aggiornata.',
                                      )
                                    }
                                  >
                                    −1
                                  </button>
                                )}
                              </>
                            )}
                          {entry.mode === 'level' &&
                            entry.certainty === 'confirmed' &&
                            entry.level === 'available' && (
                              <button
                                type="button"
                                className="quick-button"
                                disabled={Boolean(busy)}
                                onClick={() =>
                                  void performMovement(
                                    product.id,
                                    entry.id,
                                    {
                                      p_kind: 'consume',
                                      p_state: { level: 'low' },
                                    },
                                    'Segnato come quasi finito.',
                                  )
                                }
                              >
                                Quasi finito
                              </button>
                            )}
                          {entry.mode === 'level' &&
                            entry.certainty === 'confirmed' &&
                            entry.level !== 'empty' && (
                              <button
                                type="button"
                                className="quick-button"
                                disabled={Boolean(busy)}
                                onClick={() =>
                                  void performMovement(
                                    product.id,
                                    entry.id,
                                    {
                                      p_kind: 'consume',
                                      p_state: { level: 'empty' },
                                    },
                                    'Segnato come finito.',
                                  )
                                }
                              >
                                Finito
                              </button>
                            )}
                          {['measure', 'unknown'].includes(entry.mode) && (
                            <>
                              <button
                                type="button"
                                className="quick-button"
                                disabled={Boolean(busy)}
                                onClick={() => {
                                  const state = newLevelState(
                                    'low',
                                    'confirmed',
                                    entry.package_state,
                                  )
                                  state.location_id = entry.location_id
                                  state.expires_on = entry.expires_on
                                  void performMovement(
                                    product.id,
                                    entry.id,
                                    {
                                      p_kind: 'correction',
                                      p_expected_version: entry.version,
                                      p_state: state,
                                    },
                                    'Segnato come quasi finito.',
                                  )
                                }}
                              >
                                Quasi finito
                              </button>
                              <button
                                type="button"
                                className="quick-button"
                                disabled={Boolean(busy)}
                                onClick={() => {
                                  const state = newLevelState(
                                    'empty',
                                    'confirmed',
                                    entry.package_state,
                                  )
                                  state.location_id = entry.location_id
                                  state.expires_on = entry.expires_on
                                  void performMovement(
                                    product.id,
                                    entry.id,
                                    {
                                      p_kind: 'correction',
                                      p_expected_version: entry.version,
                                      p_state: state,
                                    },
                                    'Segnato come finito.',
                                  )
                                }}
                              >
                                Finito
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className="text-button"
                            disabled={Boolean(busy)}
                            onClick={() => openEditor(product, entry, 'add')}
                          >
                            Aggiungi
                          </button>
                          {((entry.mode === 'level' &&
                            entry.certainty === 'confirmed') ||
                            (['count', 'measure'].includes(entry.mode) &&
                              entry.certainty === 'confirmed')) && (
                            <button
                              type="button"
                              className="text-button"
                              disabled={Boolean(busy)}
                              onClick={() =>
                                openEditor(product, entry, 'consume')
                              }
                            >
                              Consuma
                            </button>
                          )}
                          <details className="secondary-entry-actions">
                            <summary>Altre azioni</summary>
                            <div className="secondary-entry-actions-list">
                              {(entry.mode === 'count' ||
                                entry.mode === 'measure') &&
                                entry.certainty === 'confirmed' &&
                                entry.unit &&
                                entry.quantity &&
                                entry.quantity !== '0' && (
                                  <button
                                    type="button"
                                    className="text-button"
                                    disabled={Boolean(busy)}
                                    onClick={() =>
                                      void performMovement(
                                        product.id,
                                        entry.id,
                                        {
                                          p_kind: 'consume',
                                          p_amount: entry.quantity,
                                          p_unit: entry.unit,
                                        },
                                        'Scorta segnata come finita.',
                                      )
                                    }
                                  >
                                    Segna finito
                                  </button>
                                )}
                              {entry.mode === 'count' &&
                                entry.unit === 'pack' &&
                                entry.package_state === 'sealed' &&
                                entry.certainty === 'confirmed' &&
                                Number(entry.quantity) > 0 && (
                                  <button
                                    type="button"
                                    className="text-button"
                                    disabled={Boolean(busy)}
                                    onClick={() =>
                                      openEditor(product, entry, 'open')
                                    }
                                  >
                                    Apri
                                  </button>
                                )}
                              <button
                                type="button"
                                className="text-button"
                                disabled={Boolean(busy)}
                                onClick={() =>
                                  openEditor(product, entry, 'correct')
                                }
                              >
                                Correggi
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                disabled={Boolean(busy)}
                                onClick={() =>
                                  openEditor(product, entry, 'location')
                                }
                              >
                                Posizione
                              </button>
                            </div>
                          </details>
                        </div>
                      )}
                      {editor?.productId === product.id &&
                        editor.entryId === entry.id &&
                        renderEntryEditor({
                          action: editor.action,
                          entry,
                          product,
                          locations,
                          busy: Boolean(busy),
                          operationQuantity,
                          setOperationQuantity,
                          correctionMode,
                          setCorrectionMode,
                          correctionQuantity,
                          setCorrectionQuantity,
                          correctionUnit,
                          setCorrectionUnit,
                          correctionLevel,
                          setCorrectionLevel,
                          correctionCertainty,
                          setCorrectionCertainty,
                          correctionPackage,
                          setCorrectionPackage,
                          targetLocation,
                          setTargetLocation,
                          newLocationName,
                          setNewLocationName,
                          onCancel: () => setEditor(null),
                          onSave: () => void saveCorrection(product, entry),
                          onMove: () => void saveLocation(product, entry),
                          onMovement: (request, message) =>
                            void performMovement(
                              product.id,
                              entry.id,
                              request,
                              message,
                            ),
                          onNewPurchase: (request, message) =>
                            void performMovement(
                              product.id,
                              null,
                              request,
                              message,
                            ),
                        })}
                    </div>
                  ))}
                  {writable && product.entries.length > 0 && (
                    <>
                      <button
                        className="text-button add-lot-button"
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => openEditor(product, null, 'correct')}
                      >
                        + Registra un altro lotto
                      </button>
                      {editor?.productId === product.id &&
                        editor.entryId === null &&
                        renderEntryEditor({
                          action: editor.action,
                          entry: null,
                          product,
                          locations,
                          busy: Boolean(busy),
                          operationQuantity,
                          setOperationQuantity,
                          correctionMode,
                          setCorrectionMode,
                          correctionQuantity,
                          setCorrectionQuantity,
                          correctionUnit,
                          setCorrectionUnit,
                          correctionLevel,
                          setCorrectionLevel,
                          correctionCertainty,
                          setCorrectionCertainty,
                          correctionPackage,
                          setCorrectionPackage,
                          targetLocation,
                          setTargetLocation,
                          newLocationName,
                          setNewLocationName,
                          onCancel: () => setEditor(null),
                          onSave: () => void saveCorrection(product, null),
                          onMove: () => void saveLocation(product, null),
                          onMovement: (request, message) =>
                            void performMovement(
                              product.id,
                              null,
                              request,
                              message,
                            ),
                          onNewPurchase: (request, message) =>
                            void performMovement(
                              product.id,
                              null,
                              request,
                              message,
                            ),
                        })}
                    </>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {!writable && homeProducts.length > 0 && (
        <p className="read-only-note">
          Puoi consultare queste scorte. Il tuo ruolo è di sola lettura.
        </p>
      )}
    </section>
  )

  function renderEntryEditor(props: EntryEditorProps) {
    return (
      <div className="entry-editor">
        {props.action === 'add' &&
          props.entry &&
          ['count', 'measure'].includes(props.entry.mode) &&
          props.entry.certainty === 'confirmed' && (
            <form
              className="quick-form"
              onSubmit={(event) => {
                event.preventDefault()
                if (!props.entry) return
                const amount = validateQuantity(
                  props.operationQuantity,
                  props.entry.mode === 'count',
                  false,
                )
                if (!amount) {
                  setError('Inserisci una quantità positiva e valida.')
                  return
                }
                props.onMovement(
                  {
                    p_kind: 'purchase',
                    p_amount: amount,
                    p_unit: props.entry.unit,
                  },
                  'Quantità aggiunta.',
                )
              }}
            >
              <label className="field-label">
                Aggiungi{' '}
                {props.entry?.unit ? unitLabel(props.entry.unit) : 'quantità'}
                <input
                  autoFocus
                  inputMode={
                    props.entry?.mode === 'count' ? 'numeric' : 'decimal'
                  }
                  value={props.operationQuantity}
                  onChange={(event) =>
                    props.setOperationQuantity(event.target.value)
                  }
                />
              </label>
              <button
                className="primary-button"
                disabled={
                  props.busy ||
                  !props.entry ||
                  !['count', 'measure'].includes(props.entry.mode) ||
                  props.entry.certainty !== 'confirmed'
                }
              >
                Aggiungi
              </button>
            </form>
          )}
        {props.action === 'add' &&
          (!props.entry ||
            !['count', 'measure'].includes(props.entry.mode) ||
            props.entry.certainty !== 'confirmed') && (
            <form
              className="quick-form"
              onSubmit={(event) => {
                event.preventDefault()
                const mode = props.correctionMode
                let state: InventoryState
                if (mode === 'count') {
                  const quantity = validateQuantity(
                    props.correctionQuantity,
                    true,
                    false,
                  )
                  if (
                    !quantity ||
                    !['pack', 'piece'].includes(props.correctionUnit)
                  ) {
                    setError(
                      'Inserisci un numero intero di confezioni o pezzi.',
                    )
                    return
                  }
                  state = newCountState(
                    quantity,
                    props.correctionUnit as 'pack' | 'piece',
                    props.product.formatKind === 'packaged'
                      ? props.correctionPackage
                      : 'unspecified',
                    props.correctionCertainty,
                  )
                } else if (mode === 'measure') {
                  const quantity = validateQuantity(
                    props.correctionQuantity,
                    false,
                    false,
                  )
                  if (
                    !quantity ||
                    ['pack', 'piece'].includes(props.correctionUnit)
                  ) {
                    setError(
                      'Inserisci una quantità misurata e scegli g, kg, ml o l.',
                    )
                    return
                  }
                  state = newMeasureState(
                    quantity,
                    props.correctionUnit as 'g' | 'kg' | 'ml' | 'l',
                    props.correctionCertainty,
                  )
                } else if (mode === 'level') {
                  state = newLevelState(
                    'available',
                    props.correctionCertainty,
                    props.product.formatKind === 'packaged'
                      ? props.correctionPackage
                      : 'unspecified',
                  )
                } else {
                  setError(
                    'Per aggiungere una quantità serve una disponibilità nota.',
                  )
                  return
                }
                state.location_id = props.entry?.location_id ?? null
                const purchase =
                  state.certainty === 'confirmed' &&
                  (state.mode !== 'level' || state.level === 'available')
                props.onNewPurchase(
                  {
                    p_kind: purchase ? 'purchase' : 'correction',
                    p_home_product_id: props.product.id,
                    p_state: state,
                  },
                  'Nuovo lotto aggiunto.',
                )
              }}
            >
              <label className="field-label">
                Nuovo lotto
                <select
                  value={props.correctionMode}
                  onChange={(event) =>
                    changeCorrectionMode(
                      props.product,
                      event.target.value as StockMode,
                    )
                  }
                >
                  <option value="count">Confezioni o pezzi</option>
                  <option value="measure">Quantità misurata</option>
                  <option value="level">Disponibile</option>
                </select>
              </label>
              {props.correctionMode !== 'level' && (
                <label className="field-label">
                  Quantità
                  <input
                    inputMode={
                      props.correctionMode === 'count' ? 'numeric' : 'decimal'
                    }
                    value={props.correctionQuantity}
                    onChange={(event) =>
                      props.setCorrectionQuantity(event.target.value)
                    }
                  />
                </label>
              )}
              {props.correctionMode === 'count' && (
                <label className="field-label">
                  Unità
                  <select
                    value={props.correctionUnit === 'piece' ? 'piece' : 'pack'}
                    onChange={(event) =>
                      props.setCorrectionUnit(event.target.value as StockUnit)
                    }
                  >
                    {props.product.formatKind === 'packaged' && (
                      <option value="pack">Confezioni</option>
                    )}
                    <option value="piece">Pezzi</option>
                  </select>
                </label>
              )}
              {props.correctionMode === 'measure' && (
                <label className="field-label">
                  Unità
                  <select
                    value={
                      ['g', 'kg', 'ml', 'l'].includes(props.correctionUnit)
                        ? props.correctionUnit
                        : 'kg'
                    }
                    onChange={(event) =>
                      props.setCorrectionUnit(event.target.value as StockUnit)
                    }
                  >
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                    <option value="ml">ml</option>
                    <option value="l">l</option>
                  </select>
                </label>
              )}
              <label className="field-label">
                Attendibilità
                <select
                  value={props.correctionCertainty}
                  onChange={(event) =>
                    props.setCorrectionCertainty(
                      event.target.value as 'confirmed' | 'estimated',
                    )
                  }
                >
                  <option value="confirmed">Confermata</option>
                  <option value="estimated">Stimata</option>
                </select>
              </label>
              {props.correctionMode === 'count' &&
                props.product.formatKind === 'packaged' && (
                  <label className="field-label">
                    Confezioni
                    <select
                      value={props.correctionPackage}
                      onChange={(event) =>
                        props.setCorrectionPackage(
                          event.target.value as PackageState,
                        )
                      }
                    >
                      <option value="sealed">Chiuse</option>
                      <option value="open">Aperte</option>
                      <option value="unspecified">Non specificate</option>
                    </select>
                  </label>
                )}
              <span className="inline-note">
                Una nuova quantità resta separata dal lotto sconosciuto o
                stimato già registrato.
              </span>
              <button className="primary-button" disabled={props.busy}>
                Aggiungi lotto
              </button>
            </form>
          )}
        {props.action === 'consume' && (
          <form
            className="quick-form"
            onSubmit={(event) => {
              event.preventDefault()
              const entry = props.entry
              if (!entry || !entry.unit) return
              const amount = validateQuantity(
                props.operationQuantity,
                entry.mode === 'count',
                false,
              )
              if (!amount) {
                setError('Inserisci una quantità positiva e valida.')
                return
              }
              props.onMovement(
                { p_kind: 'consume', p_amount: amount, p_unit: entry.unit },
                'Consumo registrato.',
              )
            }}
          >
            {props.entry?.mode === 'level' && (
              <label className="field-label">
                Disponibilità dopo il consumo
                <select
                  value={correctionLevel}
                  onChange={(event) =>
                    setCorrectionLevel(event.target.value as StockLevel)
                  }
                >
                  <option value="low">Quasi finito</option>
                  <option value="empty">Finito</option>
                </select>
              </label>
            )}
            {props.entry?.mode === 'level' ? (
              <button
                className="primary-button"
                type="button"
                disabled={
                  props.busy ||
                  props.entry.certainty !== 'confirmed' ||
                  props.entry.level === 'empty'
                }
                onClick={() =>
                  props.onMovement(
                    { p_kind: 'consume', p_state: { level: correctionLevel } },
                    'Disponibilità aggiornata.',
                  )
                }
              >
                Aggiorna
              </button>
            ) : (
              <>
                <label className="field-label">
                  Consuma {unitLabel(props.entry?.unit ?? null)}
                  <input
                    autoFocus
                    inputMode={
                      props.entry?.mode === 'count' ? 'numeric' : 'decimal'
                    }
                    value={props.operationQuantity}
                    onChange={(event) =>
                      props.setOperationQuantity(event.target.value)
                    }
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={
                    props.busy ||
                    !props.entry ||
                    !['count', 'measure'].includes(props.entry.mode) ||
                    props.entry.certainty !== 'confirmed'
                  }
                >
                  Registra consumo
                </button>
              </>
            )}
            {props.entry &&
              (props.entry.mode === 'unknown' ||
                props.entry.certainty === 'estimated') && (
                <span className="inline-note">
                  La quantità non è confermata. Correggila o registra un consumo
                  indicativo.
                </span>
              )}
          </form>
        )}
        {props.action === 'open' && (
          <form
            className="quick-form"
            onSubmit={(event) => {
              event.preventDefault()
              const amount = validateQuantity(
                props.operationQuantity,
                true,
                false,
              )
              if (!amount || !props.entry) {
                setError('Inserisci quante confezioni chiuse aprire.')
                return
              }
              props.onMovement(
                { p_kind: 'open', p_amount: amount, p_unit: 'pack' },
                'Confezione aperta; il contenuto resta senza quantità inventata.',
              )
            }}
          >
            <label className="field-label">
              Confezioni da aprire
              <input
                autoFocus
                inputMode="numeric"
                value={props.operationQuantity}
                onChange={(event) =>
                  props.setOperationQuantity(event.target.value)
                }
              />
            </label>
            <span className="inline-note">
              Il sistema sposta confezioni intere e crea una riga aperta senza
              inventare il peso residuo.
            </span>
            <button
              className="primary-button"
              disabled={props.busy || !props.entry}
            >
              Apri confezione
            </button>
          </form>
        )}
        {props.action === 'correct' && (
          <div className="correction-form">
            <div className="form-grid">
              <label className="field-label">
                Come vuoi registrarla?
                <select
                  value={props.correctionMode}
                  onChange={(event) =>
                    changeCorrectionMode(
                      props.product,
                      event.target.value as StockMode,
                    )
                  }
                >
                  <option value="unknown">Da verificare</option>
                  <option value="count">Quantità contata</option>
                  <option value="measure">Quantità misurata</option>
                  <option value="level">Indicativa</option>
                </select>
              </label>
              {(props.correctionMode === 'count' ||
                props.correctionMode === 'measure') && (
                <label className="field-label">
                  Quantità
                  <input
                    inputMode={
                      props.correctionMode === 'count' ? 'numeric' : 'decimal'
                    }
                    value={props.correctionQuantity}
                    onChange={(event) =>
                      props.setCorrectionQuantity(event.target.value)
                    }
                  />
                </label>
              )}
              {(props.correctionMode === 'count' ||
                props.correctionMode === 'measure') && (
                <label className="field-label">
                  Unità
                  <select
                    value={props.correctionUnit}
                    onChange={(event) =>
                      props.setCorrectionUnit(event.target.value as StockUnit)
                    }
                  >
                    {props.correctionMode === 'count' ? (
                      <>
                        {props.product.formatKind === 'packaged' && (
                          <option value="pack">Confezioni</option>
                        )}
                        <option value="piece">Pezzi</option>
                      </>
                    ) : (
                      <>
                        <option value="g">g</option>
                        <option value="kg">kg</option>
                        <option value="ml">ml</option>
                        <option value="l">l</option>
                      </>
                    )}
                  </select>
                </label>
              )}
              {props.correctionMode === 'level' && (
                <label className="field-label">
                  Livello
                  <select
                    value={props.correctionLevel}
                    onChange={(event) =>
                      props.setCorrectionLevel(event.target.value as StockLevel)
                    }
                  >
                    <option value="available">Disponibile</option>
                    <option value="low">Quasi finito</option>
                    <option value="empty">Finito</option>
                  </select>
                </label>
              )}
              {props.correctionMode !== 'unknown' && (
                <label className="field-label">
                  Attendibilità
                  <select
                    value={props.correctionCertainty}
                    onChange={(event) =>
                      props.setCorrectionCertainty(
                        event.target.value as 'confirmed' | 'estimated',
                      )
                    }
                  >
                    <option value="confirmed">Confermata</option>
                    <option value="estimated">Stimata</option>
                  </select>
                </label>
              )}
              {props.product.formatKind === 'packaged' &&
                (props.correctionMode === 'count' ||
                  props.correctionMode === 'level') && (
                  <label className="field-label">
                    Confezione
                    <select
                      value={props.correctionPackage}
                      onChange={(event) =>
                        props.setCorrectionPackage(
                          event.target.value as PackageState,
                        )
                      }
                    >
                      {props.correctionMode === 'count' && (
                        <option value="sealed">Chiusa</option>
                      )}
                      <option value="open">Aperta</option>
                      <option value="unspecified">Non specificata</option>
                    </select>
                  </label>
                )}
              {props.entry === null && (
                <label className="field-label">
                  Posizione
                  <select
                    value={props.targetLocation}
                    onChange={(event) =>
                      props.setTargetLocation(event.target.value)
                    }
                  >
                    <option value="">Nessuna posizione</option>
                    {props.locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="form-actions">
              <span className="inline-note">
                Una correzione sostituisce solo questo lotto e conserva lo
                storico.
              </span>
              <button
                className="primary-button"
                type="button"
                disabled={props.busy}
                onClick={props.onSave}
              >
                Salva disponibilità
              </button>
            </div>
          </div>
        )}
        {props.action === 'location' && (
          <div className="quick-form location-form">
            <label className="field-label">
              Posizione
              <select
                value={props.targetLocation}
                onChange={(event) =>
                  props.setTargetLocation(event.target.value)
                }
              >
                <option value="">Nessuna</option>
                {props.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Oppure crea una posizione
              <input
                maxLength={80}
                value={props.newLocationName}
                onChange={(event) =>
                  props.setNewLocationName(event.target.value)
                }
                placeholder="Es. Dispensa"
              />
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={props.busy || !props.entry}
              onClick={props.onMove}
            >
              Salva posizione
            </button>
          </div>
        )}
        <button
          className="quiet-button editor-close"
          type="button"
          onClick={props.onCancel}
        >
          Chiudi
        </button>
      </div>
    )
  }
}

type EntryEditorProps = {
  action: EditorAction
  entry: StockEntry | null
  product: InventoryProduct
  locations: StorageLocation[]
  busy: boolean
  operationQuantity: string
  setOperationQuantity: (value: string) => void
  correctionMode: StockMode
  setCorrectionMode: (value: StockMode) => void
  correctionQuantity: string
  setCorrectionQuantity: (value: string) => void
  correctionUnit: StockUnit
  setCorrectionUnit: (value: StockUnit) => void
  correctionLevel: StockLevel
  setCorrectionLevel: (value: StockLevel) => void
  correctionCertainty: 'confirmed' | 'estimated'
  setCorrectionCertainty: (value: 'confirmed' | 'estimated') => void
  correctionPackage: PackageState
  setCorrectionPackage: (value: PackageState) => void
  targetLocation: string
  setTargetLocation: (value: string) => void
  newLocationName: string
  setNewLocationName: (value: string) => void
  onCancel: () => void
  onSave: () => void
  onMove: () => void
  onMovement: (request: MovementRequest, message: string) => void
  onNewPurchase: (request: MovementRequest, message: string) => void
}
