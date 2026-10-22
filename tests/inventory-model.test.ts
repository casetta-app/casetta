import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  filterProducts,
  formatQuantity,
  matchesAvailability,
  newUnknownState,
  productAvailabilitySummary,
  stateLabel,
  validateQuantity,
  type InventoryProduct,
  type StockEntry,
} from '../src/inventory/model.ts'

function entry(values: Partial<StockEntry> = {}): StockEntry {
  return {
    id: 'entry',
    mode: 'unknown',
    quantity: null,
    unit: null,
    level: null,
    certainty: 'unknown',
    package_state: 'unspecified',
    package_count: null,
    location_id: null,
    expires_on: null,
    version: 1,
    location: null,
    ...values,
  }
}

function product(entries: StockEntry[] = []): InventoryProduct {
  return {
    id: 'home-product',
    formatId: 'format',
    name: 'Pasta',
    brand: null,
    category: 'food',
    alias: null,
    formatLabel: 'Pacco da 500 g',
    formatKind: 'packaged',
    formatSizeUnit: 'g',
    entries,
  }
}

test('quantità decimali conserva precisione, virgola locale e zero esplicito', () => {
  assert.equal(validateQuantity('1,250000', false), '1.25')
  assert.equal(validateQuantity('0', false), '0')
  assert.equal(formatQuantity('1.25'), '1,25')
  assert.equal(validateQuantity('0', false, false), null)
  assert.equal(validateQuantity('1.0000001', false), null)
  assert.equal(validateQuantity('1000000000000', false), null)
  assert.equal(validateQuantity('-1', false), null)
  assert.equal(validateQuantity('1.5', true), null)
})

test('zero confermato è distinto da disponibilità sconosciuta', () => {
  const zero = entry({
    mode: 'count',
    quantity: '0',
    unit: 'pack',
    certainty: 'confirmed',
  })
  const unknown = entry()
  assert.equal(stateLabel(zero), 'Finito · zero confermato')
  assert.equal(stateLabel(unknown), 'Da verificare')
  assert.equal(matchesAvailability([zero], 'empty'), true)
  assert.equal(matchesAvailability([unknown], 'empty'), false)
  assert.equal(matchesAvailability([unknown], 'check'), true)
  assert.equal(newUnknownState().quantity, null)
})

test('filtri cercano nome, marca, alias e formato senza sommare lotti incompatibili', () => {
  const mixed = product([
    entry({
      id: 'packs',
      mode: 'count',
      quantity: '2',
      unit: 'pack',
      certainty: 'confirmed',
    }),
    entry({
      id: 'open',
      mode: 'level',
      quantity: null,
      unit: null,
      level: 'low',
      certainty: 'estimated',
      package_state: 'open',
    }),
  ])
  assert.equal(filterProducts([mixed], 'pacco', 'food', 'all').length, 1)
  assert.equal(filterProducts([mixed], 'riso', 'food', 'all').length, 0)
  assert.equal(matchesAvailability(mixed.entries, 'available'), true)
  assert.equal(matchesAvailability(mixed.entries, 'low'), true)
  assert.equal(matchesAvailability(mixed.entries, 'empty'), false)
  assert.equal(matchesAvailability(mixed.entries, 'check'), true)
  assert.deepEqual(filterProducts([mixed], '', 'household', 'all'), [])
})

test('assenza di righe significa non censito e non quantità zero', () => {
  const item = product([])
  assert.equal(matchesAvailability(item.entries, 'check'), true)
  assert.equal(matchesAvailability(item.entries, 'empty'), false)
  assert.equal(matchesAvailability(item.entries, 'available'), false)
})

test('riepilogo prodotto distingue lotti esauriti e disponibili senza sommarli', () => {
  const empty = entry({
    id: 'empty',
    mode: 'count',
    quantity: '0',
    unit: 'pack',
    certainty: 'confirmed',
  })
  const available = entry({
    id: 'available',
    mode: 'measure',
    quantity: '750',
    unit: 'g',
    certainty: 'confirmed',
  })
  assert.deepEqual(productAvailabilitySummary([empty, available]), {
    label: '1 lotto disponibile · 1 esaurito',
    tone: 'available',
  })
  assert.deepEqual(productAvailabilitySummary([empty]), {
    label: 'Tutti i lotti esauriti',
    tone: 'empty',
  })
  assert.deepEqual(
    productAvailabilitySummary([
      entry({
        mode: 'count',
        quantity: '3',
        unit: 'pack',
        certainty: 'estimated',
      }),
    ]),
    { label: 'Disponibilità stimata', tone: 'estimated' },
  )
  assert.deepEqual(productAvailabilitySummary([entry()]), {
    label: 'Disponibilità da verificare',
    tone: 'unknown',
  })
})
