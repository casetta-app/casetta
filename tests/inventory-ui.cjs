// Verifica UI browser con Supabase simulato in memoria: nessun account o DB remoto.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const base = 'http://127.0.0.1:5173/casetta/'
const mock = `
const homes = [
  { id: 'home-a', name: 'Casa A' },
  { id: 'home-b', name: 'Casa B' },
];
const db = {
  products: [{ id: 'pasta', name: 'Pasta', brand: null, category: 'food', scope_home_id: null, formats: [{ id: 'pasta-format', label: 'Pacco 500 g', kind: 'packaged', size_unit: 'g', barcode: null, size_quantity: '500' }] }],
  homeProducts: [
    { id: 'hp-pasta-a', home_id: 'home-a', format_id: 'pasta-format', alias: null, productId: 'pasta', entries: [{ id: 'entry-pasta', home_id: 'home-a', home_product_id: 'hp-pasta-a', mode: 'count', quantity: '3', unit: 'pack', level: null, certainty: 'confirmed', package_state: 'sealed', package_count: null, location_id: 'pantry', expires_on: null, version: 1, storage_locations: { id: 'pantry', name: 'Dispensa' } }] },
    { id: 'hp-sale-b', home_id: 'home-b', format_id: 'sale-format', alias: null, productId: 'sale', entries: [{ id: 'entry-sale', home_id: 'home-b', home_product_id: 'hp-sale-b', mode: 'unknown', quantity: null, unit: null, level: null, certainty: 'unknown', package_state: 'unspecified', package_count: null, location_id: null, expires_on: null, version: 1, storage_locations: null }] },
  ],
  locations: [{ id: 'pantry', home_id: 'home-a', name: 'Dispensa' }],
  formats: [{ id: 'pasta-format', product_id: 'pasta', label: 'Pacco 500 g', kind: 'packaged', barcode: null, size_quantity: '500', size_unit: 'g' }, { id: 'sale-format', product_id: 'sale', label: 'Confezione', kind: 'packaged', barcode: null, size_quantity: null, size_unit: null }],
  movements: [], nextId: 0,
};
db.products.push({ id: 'sale', name: 'Sale', brand: null, category: 'food', scope_home_id: null, formats: [db.products[0].formats[0]] });
db.products[1].formats = [db.formats[1]];
window.__inventoryDb = db;
const error = null;
class Query {
  constructor(table) { this.table = table; this.filters = []; this.insertValue = null; }
  select() { return this; }
  eq(key, value) { this.filters.push(['eq', key, value]); return this; }
  is(key, value) { this.filters.push(['eq', key, value]); return this; }
  in(key, values) { this.filters.push(['in', key, values]); return this; }
  ilike(key, value) { this.filters.push(['ilike', key, value.replace(/^%|%$/g, '').toLowerCase()]); return this; }
  or() { return this; }
  order() { return this; }
  limit() { return this; }
  insert(value) { this.insertValue = Array.isArray(value) ? value[0] : value; return this; }
  async single() { return { data: this.executeInsert(), error }; }
  async maybeSingle() { return { data: this.rows()[0] || null, error }; }
  matches(row) { return this.filters.every(([kind, key, value]) => kind === 'in' ? value.includes(row[key]) : kind === 'ilike' ? String(row[key] || '').toLowerCase().includes(value) : row[key] === value); }
  rows() {
    if (this.table === 'home_members') return homes.filter(h => h.id === 'home-a' || h.id === 'home-b').map(h => ({ home_id: h.id, user_id: 'user-a', role: window.__role || 'editor', relationship: 'resident', revoked_at: null, joined_at: '2026-01-01', homes: h }));
    if (this.table === 'home_products') {
      const hps = db.homeProducts.filter(this.matches.bind(this));
      if (this.filters.some(f => f[0] === 'in')) return hps.map(hp => ({ id: hp.id, format_id: hp.format_id }));
      return hps.map(hp => { const format = db.formats.find(f => f.id === hp.format_id); const product = db.products.find(p => p.id === hp.productId); return { id: hp.id, format_id: hp.format_id, alias: hp.alias, product_formats: { id: format.id, label: format.label, kind: format.kind, size_unit: format.size_unit, products: { id: product.id, name: product.name, brand: product.brand, category: product.category } }, stock_entries: hp.entries }; });
    }
    if (this.table === 'products') return db.products.filter(this.matches.bind(this)).map(p => ({ id: p.id, name: p.name, brand: p.brand, category: p.category, scope_home_id: p.scope_home_id, product_formats: p.formats }));
    if (this.table === 'storage_locations') return db.locations.filter(this.matches.bind(this));
    return [];
  }
  executeInsert() {
    const value = this.insertValue;
    if (this.table === 'products') {
      const row = { ...value, id: 'product-' + (++db.nextId), formats: [] }; db.products.push(row); return { id: row.id };
    }
    if (this.table === 'product_formats') {
      const row = { ...value, id: 'format-' + (++db.nextId) }; db.formats.push(row); db.products.find(p => p.id === row.product_id).formats.push(row); return { id: row.id };
    }
    if (this.table === 'home_products') {
      const row = { ...value, id: 'home-product-' + (++db.nextId), productId: db.formats.find(f => f.id === value.format_id).product_id, entries: [] }; db.homeProducts.push(row); return { id: row.id };
    }
    if (this.table === 'storage_locations') {
      const row = { ...value, id: 'location-' + (++db.nextId) }; db.locations.push(row); return row;
    }
    return null;
  }
  then(resolve, reject) { return Promise.resolve({ data: this.rows(), error }).then(resolve, reject); }
}
const session = { user: { id: 'user-a', email: 'person@example.invalid' }, access_token: 'mock', refresh_token: 'mock', expires_at: 9999999999, token_type: 'bearer' };
export const supabase = {
  auth: {
    onAuthStateChange(callback) { queueMicrotask(() => callback('INITIAL_SESSION', session)); return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session }, error: null }; },
    async signOut() { return { error: null }; },
  },
  from(table) { return new Query(table); },
  async rpc(_name, args) {
    if (_name === 'add_inventory_product') {
      db.additions ||= new Map();
      if (db.additions.has(args.p_key)) return { data: db.additions.get(args.p_key), error: null };
      let formatId = args.p_format_id;
      if (args.p_product) {
        const p = args.p_product;
        const product = await new Query('products').insert({ scope_home_id: args.p_home_id, name: p.name, brand: p.brand, category: p.category }).single();
        const format = await new Query('product_formats').insert({ product_id: product.data.id, label: p.label, kind: p.kind, barcode: p.barcode, size_quantity: p.size_quantity, size_unit: p.size_unit }).single();
        formatId = format.data.id;
      }
      let hp = db.homeProducts.find(x => x.home_id === args.p_home_id && x.format_id === formatId);
      const created = !hp;
      let movement = null;
      if (!hp) {
        const added = await new Query('home_products').insert({ home_id: args.p_home_id, format_id: formatId }).single();
        hp = db.homeProducts.find(x => x.id === added.data.id);
        movement = (await supabase.rpc('record_stock_movement', { p_home_id: args.p_home_id, p_key: args.p_key, p_kind: 'correction', p_home_product_id: hp.id, p_state: args.p_initial_state })).data;
      }
      const data = { home_product_id: hp.id, created, movement_id: movement };
      db.additions.set(args.p_key, data);
      return { data, error: null };
    }
    const prior = db.movements.find(item => item.key === args.p_key);
    if (prior) return { data: prior.id, error: null };
    const id = 'movement-' + (++db.nextId);
    const hp = db.homeProducts.find(item => item.id === args.p_home_product_id || item.entries.some(entry => entry.id === args.p_entry_id));
    let entry = args.p_entry_id ? hp.entries.find(item => item.id === args.p_entry_id) : null;
    if (args.p_kind === 'open') {
      entry.quantity = String(Number(entry.quantity) - Number(args.p_amount)); entry.version++;
      hp.entries.push({ ...entry, id: 'entry-' + (++db.nextId), mode: 'level', quantity: null, unit: null, level: 'available', package_state: 'open', package_count: Number(args.p_amount), location_id: null, storage_locations: null, version: 1 });
    } else if (args.p_entry_id && args.p_kind === 'purchase' && entry.mode === 'count') { entry.quantity = String(Number(entry.quantity) + Number(args.p_amount)); entry.version++; }
    else if (args.p_entry_id && args.p_kind === 'consume' && args.p_state) { entry.level = args.p_state.level; entry.mode = 'level'; entry.quantity = null; entry.unit = null; entry.certainty = 'confirmed'; entry.version++; }
    else if (args.p_entry_id && args.p_kind === 'consume') { entry.quantity = String(Number(entry.quantity) - Number(args.p_amount)); entry.version++; }
    else if (args.p_entry_id && args.p_kind === 'correction') { Object.assign(entry, args.p_state, { version: entry.version + 1 }); }
    else if (args.p_entry_id && args.p_kind === 'move') { entry.location_id = args.p_location_id; entry.storage_locations = db.locations.find(x => x.id === args.p_location_id) || null; entry.version++; }
    else if (!entry) { const fresh = { id: 'entry-' + (++db.nextId), home_id: hp.home_id, home_product_id: hp.id, ...args.p_state, version: 1, storage_locations: null }; hp.entries.push(fresh); }
    db.movements.push({ key: args.p_key, id });
    return { data: id, error: null };
  },
};
`

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-proxy-server'],
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  })
  let externalRequests = 0
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== new URL(base).origin) {
        externalRequests++
        return route.abort()
      }
      if (url.pathname.endsWith('/src/lib/supabase.ts'))
        return route.fulfill({
          contentType: 'application/javascript',
          body: mock,
        })
      return route.continue()
    })
    await page.addInitScript(() => {
      window.__role = 'editor'
    })
    await page.goto(`${base}#/scorte`)
    await page.getByRole('heading', { name: 'Scorte', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Pasta', exact: true }).waitFor()
    assert.match(await page.locator('.stock-card').innerText(), /Dispensa/)

    await page.getByRole('button', { name: 'Apri', exact: true }).click()
    await page.getByLabel('Confezioni da aprire').fill('1')
    await page.getByRole('button', { name: 'Apri confezione' }).click()
    await page.getByText('2 confezioni', { exact: false }).waitFor()
    await page.getByText('1 confezione aperta', { exact: true }).waitFor()

    const increment = page.getByRole('button', { name: '+1', exact: true })
    await increment.evaluate((button) => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.getByText('3 confezioni', { exact: false }).waitFor()
    assert.equal(
      await page.evaluate(
        () => window.__inventoryDb.movements.filter((x) => x.key).length,
      ),
      2,
      'il doppio tocco rapido deve inviare un solo movimento',
    )

    await page.locator('.add-product-button').click()
    await page.getByLabel(/Cerca nel catalogo/).fill('Pasta')
    await page.getByText(/Già nelle scorte/).waitFor()
    assert.equal(
      await page.getByRole('button', { name: /Già nelle scorte/ }).isDisabled(),
      true,
    )
    await page.getByRole('button', { name: 'Chiudi' }).click()

    await page.locator('.add-product-button').click()
    await page.getByLabel(/Nome/).fill('Sapone')
    await page
      .getByRole('button', { name: 'Aggiungi alle scorte', exact: true })
      .click()
    await page.getByRole('heading', { name: 'Sapone', exact: true }).waitFor()
    const soap = await page.evaluate(() => {
      const product = window.__inventoryDb.products.find(
        (x) => x.name === 'Sapone',
      )
      const item = window.__inventoryDb.homeProducts.find(
        (x) => x.productId === product?.id,
      )
      if (!item) throw Error('Prodotto non collegato all’abitazione')
      return {
        ...item,
        barcode: window.__inventoryDb.products.find(
          (x) => x.id === item.productId,
        ).formats[0].barcode,
      }
    })
    assert.ok(soap)
    assert.equal(soap.entries[0].mode, 'unknown')
    assert.equal(soap.barcode, null)
    assert.match(
      await page
        .locator('.stock-card')
        .filter({ hasText: 'Sapone' })
        .innerText(),
      /Da verificare/,
    )

    await page
      .locator('.stock-card')
      .filter({ hasText: 'Sapone' })
      .getByRole('button', { name: 'Correggi' })
      .click()
    await page.getByLabel('Come vuoi registrarla?').selectOption('measure')
    await page.getByLabel('Quantità', { exact: true }).fill('1,25')
    await page.locator('.correction-form select').nth(1).selectOption('kg')
    await page
      .locator('.correction-form select')
      .nth(2)
      .selectOption('estimated')
    await page.getByRole('button', { name: 'Salva disponibilità' }).click()
    await page.getByText('1,25 kg', { exact: true }).waitFor()
    await page.getByText('Stimato', { exact: true }).waitFor()

    const soapCard = page.locator('.stock-card').filter({ hasText: 'Sapone' })
    await soapCard.getByRole('button', { name: 'Correggi' }).click()
    await page.getByLabel('Come vuoi registrarla?').selectOption('level')
    await page
      .locator('.correction-form select')
      .nth(1)
      .selectOption('available')
    await page
      .locator('.correction-form select')
      .nth(2)
      .selectOption('confirmed')
    await page.getByRole('button', { name: 'Salva disponibilità' }).click()
    await soapCard.getByText('Disponibile', { exact: true }).waitFor()
    await soapCard.getByRole('button', { name: 'Consuma', exact: true }).click()
    await page.getByLabel('Disponibilità dopo il consumo').selectOption('low')
    await page.getByRole('button', { name: 'Aggiorna', exact: true }).click()
    await soapCard.getByText('Quasi finito', { exact: true }).waitFor()
    await soapCard.getByRole('button', { name: 'Consuma', exact: true }).click()
    assert.equal(
      await page.getByLabel('Disponibilità dopo il consumo').inputValue(),
      'empty',
    )
    await page.getByRole('button', { name: 'Aggiorna', exact: true }).click()
    await soapCard.getByText('Finito', { exact: true }).waitFor()

    await soapCard
      .getByRole('button', { name: 'Posizione', exact: true })
      .click()
    await page.getByLabel(/Oppure crea una posizione/).fill('Bagno')
    await page.getByRole('button', { name: 'Salva posizione' }).click()
    await soapCard.getByText('Bagno', { exact: true }).waitFor()

    await page.getByLabel('Abitazione attiva').selectOption('home-b')
    await page.getByRole('heading', { name: 'Sale', exact: true }).waitFor()
    assert.equal(
      await page.getByRole('heading', { name: 'Pasta', exact: true }).count(),
      0,
    )
    assert.equal(
      await page.getByRole('heading', { name: 'Sapone', exact: true }).count(),
      0,
    )
    assert.equal(externalRequests, 0)
    assert.deepEqual(errors, [])
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    )
    console.log(
      'PASS: UI owner/editor, aggiunta senza barcode e quantità, catalogo senza duplicato, apertura, correzione stimata, idempotenza rapida, cambio casa e layout iPhone 390×844',
    )
    await page.close()

    const viewer = await browser.newPage({
      viewport: { width: 390, height: 844 },
    })
    await viewer.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== new URL(base).origin) {
        externalRequests++
        return route.abort()
      }
      if (url.pathname.endsWith('/src/lib/supabase.ts'))
        return route.fulfill({
          contentType: 'application/javascript',
          body: mock,
        })
      return route.continue()
    })
    await viewer.addInitScript(() => {
      window.__role = 'viewer'
    })
    await viewer.goto(`${base}#/scorte`)
    await viewer.getByRole('heading', { name: 'Pasta', exact: true }).waitFor()
    assert.equal(
      await viewer
        .getByRole('button', { name: 'Aggiungi', exact: true })
        .count(),
      0,
    )
    assert.equal(
      await viewer.getByRole('button', { name: '+1', exact: true }).count(),
      0,
    )
    assert.match(
      await viewer.locator('.read-only-note').innerText(),
      /sola lettura/,
    )
    console.log('PASS: UI viewer in sola lettura')
    await viewer.close()
    assert.equal(
      externalRequests,
      0,
      'test browser non devono effettuare chiamate esterne',
    )
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
