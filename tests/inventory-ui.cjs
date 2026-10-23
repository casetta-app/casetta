// Verifica UI browser con Supabase simulato in memoria: nessun account o DB remoto.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const base = 'http://127.0.0.1:5173/casetta/'
const longHomeName =
  'Casa condivisa con un nome volutamente lungo per i test mobile'
const mock = `
const homes = [
  { id: 'home-a', name: '${longHomeName}' },
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
    if (this.table === 'home_members') return homes.filter(h => !(window.__revoked || []).includes(h.id)).map(h => ({ home_id: h.id, user_id: 'user-a', role: window.__role || 'editor', relationship: 'resident', revoked_at: null, joined_at: '2026-01-01', homes: h }));
    if (this.table === 'home_products') {
      const hps = db.homeProducts.filter(this.matches.bind(this));
      if (this.filters.some(f => f[0] === 'in')) return hps.map(hp => ({ id: hp.id, format_id: hp.format_id }));
      return hps.map(hp => { const format = db.formats.find(f => f.id === hp.format_id); const product = db.products.find(p => p.id === hp.productId); return { id: hp.id, format_id: hp.format_id, alias: hp.alias, product_formats: { id: format.id, label: format.label, kind: format.kind, size_unit: format.size_unit, products: { id: product.id, name: product.name, brand: product.brand, category: product.category } }, stock_entries: hp.entries }; });
    }
    if (this.table === 'product_formats') return (window.__barcodeMatches || []).filter(this.matches.bind(this));
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
  then(resolve, reject) {
    const result = () => ({ data: this.rows(), error: (this.table === 'home_members' && window.__homeFailure || this.table === 'product_formats' && window.__barcodeFailure) ? {message: 'offline'} : null });
    if (this.table === 'product_formats' && window.__holdBarcode) return new Promise(done => { window.__releaseBarcode = () => done(result()) }).then(resolve,reject);
    if (this.table === 'home_members' && window.__holdHomes) return new Promise(done => { window.__releaseHomes = () => done(result()) }).then(resolve, reject);
    return Promise.resolve(result()).then(resolve, reject);
  }
}
const session = { user: { id: 'user-a', email: 'person@example.invalid' }, access_token: 'mock', refresh_token: 'mock', expires_at: 9999999999, token_type: 'bearer' };
export const supabase = {
  functions: { async invoke() { window.__offCalls=(window.__offCalls||0)+1; return {data:window.__offResponse || {status:'absent'},error:null} } },
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

async function openOtherActions(card) {
  const actions = card.locator('.secondary-entry-actions')
  if (!(await actions.evaluate((element) => element.open))) {
    await actions.locator('summary').click()
  }
}

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
      if (url.pathname.endsWith('/src/scanner/decoder.ts'))
        return route.fulfill({
          contentType: 'application/javascript',
          body: `export async function createFrameDecoder() { window.__decode = text => {window.__pendingCode=text}; return () => { window.__frameReads=(window.__frameReads||0)+1; const value=window.__pendingCode; window.__pendingCode=null; return value || null } }`,
        })
      if (url.pathname.endsWith('/src/lib/supabase.ts'))
        return route.fulfill({
          contentType: 'application/javascript',
          body: mock,
        })
      return route.continue()
    })
    await page.addInitScript(() => {
      window.__role = 'editor'
      const originalInterval = window.setInterval
      window.setInterval = (callback, ms, ...args) => {
        if (ms === 30000) window.__checkHomes = callback
        return originalInterval(callback, ms, ...args)
      }
      HTMLMediaElement.prototype.play = async function () {
        window.__videoPlays = (window.__videoPlays || 0) + 1
      }
      HTMLMediaElement.prototype.pause = function () {}
      Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
        configurable: true,
        get: () => 2,
      })
      Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
        configurable: true,
        get: () => 1280,
      })
      Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
        configurable: true,
        get: () => 720,
      })
      HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} })
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
        configurable: true,
        get() {
          return this.__stream
        },
        set(value) {
          this.__stream = value
        },
      })
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            throw new DOMException('Denied', 'NotAllowedError')
          },
        },
      })
    })
    await page.goto(`${base}#/scorte`)
    await page.getByRole('heading', { name: 'Scorte', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Pasta', exact: true }).waitFor()
    assert.equal(
      await page.locator('.home-active-name').innerText(),
      longHomeName,
    )
    assert.equal(await page.locator('.home-role').isVisible(), false)
    assert.equal(
      await page
        .locator('.home-switcher select')
        .evaluate((select) => select.getBoundingClientRect().width),
      44,
    )
    assert.ok(
      await page
        .locator('.topbar')
        .evaluate((bar) => bar.getBoundingClientRect().height < 130),
    )
    assert.match(await page.locator('.stock-card').innerText(), /Dispensa/)
    await page.locator('.add-product-button').click()
    await page.getByRole('button', { name: 'Scansiona', exact: true }).click()
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            throw new DOMException('Denied', 'NotAllowedError')
          },
        },
      })
    })
    await page.getByText(/Accesso alla fotocamera negato/).waitFor()
    await page.locator('.scanner-manual summary').click()
    await page.getByLabel('Barcode manuale').fill('4006381333931')
    await page
      .getByRole('button', { name: 'Cerca codice', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Inserisci prodotto con questo barcode' })
      .click()
    assert.equal(
      await page.getByLabel(/Codice a barre/).inputValue(),
      '4006381333931',
    )
    assert.equal(await page.getByLabel(/Nome/).inputValue(), '')
    await page.getByLabel(/Codice a barre/).fill('')
    await page
      .locator('.add-panel')
      .getByRole('button', { name: 'Chiudi', exact: true })
      .click()

    await page.locator('.add-product-button').click()
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => ({
        getTracks: () => [
          {
            stop: () => {
              window.__trackStops = (window.__trackStops || 0) + 1
            },
          },
        ],
      })
      window.__barcodeMatches = [
        {
          id: 'pasta-format',
          label: '500 g',
          barcode: '4006381333931',
          products: { name: 'Pasta', brand: null },
        },
        {
          id: 'other-format',
          label: 'Altro formato',
          barcode: '4006381333931',
          products: { name: 'Altro prodotto', brand: null },
        },
      ]
    })
    await page.getByRole('button', { name: 'Scansiona', exact: true }).click()
    await page.waitForFunction(() => Boolean(window.__decode))
    await page.evaluate(() => {
      window.__trackStopsBeforeRefresh = window.__trackStops || 0
      window.__stockIdentity = document.querySelector('.stock-page')
      window.__holdHomes = true
      window.__checkHomes()
    })
    await page.waitForFunction(() => Boolean(window.__releaseHomes))
    assert.equal(await page.locator('.scanner-panel').isVisible(), true)
    assert.ok(
      await page.evaluate(
        () =>
          document.querySelector('.stock-page') === window.__stockIdentity &&
          (window.__trackStops || 0) === window.__trackStopsBeforeRefresh,
      ),
    )
    await page.evaluate(() => {
      window.__holdHomes = false
      window.__releaseHomes()
    })
    assert.ok(
      await page.evaluate(
        () => document.querySelector('.stock-page') === window.__stockIdentity,
      ),
    )
    const beforeScan = await page.evaluate(
      () => window.__inventoryDb.movements.length,
    )
    await page.evaluate(() => {
      window.__holdBarcode = true
      window.__decode('4006381333931')
      window.__decode('4006381333931')
    })
    await page.waitForFunction(() => Boolean(window.__releaseBarcode))
    await page.setViewportSize({ width: 320, height: 568 })
    const immediate = await page
      .locator('.scanner-feedback strong')
      .boundingBox()
    assert.ok(
      immediate && immediate.y >= 0 && immediate.y + immediate.height < 568,
    )
    const reads = await page.evaluate(() => window.__frameReads)
    await page.waitForTimeout(400)
    assert.equal(await page.evaluate(() => window.__frameReads), reads)
    await page.evaluate(() => {
      window.__holdBarcode = false
      window.__releaseBarcode()
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(
      () => document.querySelectorAll('.scanner-match').length === 2,
    )
    const resultBounds = await page
      .locator('.scanner-feedback strong')
      .boundingBox()
    assert.ok(
      resultBounds &&
        resultBounds.y >= 0 &&
        resultBounds.y + resultBounds.height < 844,
    )
    assert.equal(
      await page.getByRole('button', { name: 'Arresta fotocamera' }).count(),
      0,
    )
    assert.equal(
      await page
        .getByRole('button', { name: 'Conferma aggiunta', exact: true })
        .count(),
      2,
    )
    assert.equal(
      await page.evaluate(() => window.__inventoryDb.movements.length),
      beforeScan,
    )
    await page
      .getByRole('button', { name: 'Conferma aggiunta', exact: true })
      .first()
      .click()
    await page
      .getByText(/Formato già nelle scorte: quantità invariata/)
      .waitFor()
    assert.equal(
      await page.evaluate(() => window.__inventoryDb.movements.length),
      beforeScan,
    )
    await page.waitForTimeout(1300)
    await page.evaluate(() => window.__decode('4006381333931'))
    await page.getByText(/Codice già letto in questa sessione/).waitFor()
    await page.evaluate(() => {
      window.__barcodeFailure = true
      window.__decode('96385074')
    })
    await page.getByText(/Errore di ricerca. Il prodotto/).waitFor()
    assert.equal(
      await page
        .getByRole('button', { name: 'Inserisci prodotto con questo barcode' })
        .count(),
      0,
    )
    await page
      .getByRole('button', { name: 'Prossimo codice', exact: true })
      .click()
    await page.evaluate(() => {
      window.__barcodeFailure = false
    })
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    assert.ok(await page.evaluate(() => window.__trackStops > 0))
    await page.getByRole('button', { name: 'Riprendi fotocamera' }).click()
    await page.getByText(/Fotocamera attiva/).waitFor()
    const beforeHomeChange = await page.evaluate(() => window.__trackStops)
    await page.getByLabel('Cambia abitazione').evaluate((select) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set
      setter.call(select, 'home-b')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.getByRole('heading', { name: 'Sale', exact: true }).waitFor()
    assert.ok(
      await page.evaluate(
        (previous) => window.__trackStops > previous,
        beforeHomeChange,
      ),
    )
    await page.getByLabel('Cambia abitazione').selectOption('home-a')
    await page.getByRole('heading', { name: 'Pasta', exact: true }).waitFor()

    assert.equal(
      await page
        .locator('.secondary-entry-actions')
        .evaluate((details) => details.open),
      false,
    )
    await page.locator('.secondary-entry-actions summary').click()
    assert.equal(
      await page
        .locator('.secondary-entry-actions')
        .evaluate((details) => details.open),
      true,
    )
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
    assert.equal(
      await page
        .locator('.additional-product-details')
        .evaluate((node) => node.open),
      false,
    )
    await page.getByLabel(/Nome/).waitFor()
    await page.locator('.essential-product-fields select').waitFor()
    assert.equal(await page.getByLabel(/Marca/).isVisible(), false)
    await page.getByText('Altri dettagli').click()
    await page.getByLabel(/Marca/).waitFor()
    await page.getByLabel(/Codice a barre/).waitFor()
    await page.getByText('Altri dettagli').click()
    assert.equal(
      await page
        .locator('.additional-product-details')
        .evaluate((node) => node.open),
      false,
    )
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
      .locator('.secondary-entry-actions summary')
      .click()
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
    await openOtherActions(soapCard)
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

    await openOtherActions(soapCard)
    await soapCard
      .getByRole('button', { name: 'Posizione', exact: true })
      .click()
    await page.getByLabel(/Oppure crea una posizione/).fill('Bagno')
    await page.getByRole('button', { name: 'Salva posizione' }).click()
    await soapCard.getByText('Bagno', { exact: true }).waitFor()

    await page.getByLabel('Cambia abitazione').selectOption('home-b')
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
    await page.setViewportSize({ width: 1280, height: 900 })
    assert.equal(await page.locator('.home-role').isVisible(), true)
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    )
    await page.goto(`${base}#/oggi`)
    await page.getByRole('heading', { name: 'Oggi', exact: true }).waitFor()
    assert.equal(await page.getByText(/non ancora attivati/).count(), 0)
    await page.getByRole('link', { name: 'Apri le scorte' }).click()
    await page.getByRole('heading', { name: 'Scorte', exact: true }).waitFor()
    console.log(
      'PASS: UI owner/editor, form richiudibile, campi essenziali e facoltativi, aggiunta senza barcode e quantità, catalogo, movimenti, cambio casa, layout mobile/desktop e link Oggi → Scorte',
    )
    await page.evaluate(() => {
      window.__offResponse = {
        status: 'found',
        proposal: {
          name: 'Pasta OFF',
          brand: 'Marca suggerita',
          label: '500 g',
          quantity: '500',
          unit: 'g',
          barcode: '96385074',
          sourceRef: 'https://world.openfoodfacts.org/product/96385074',
        },
      }
    })
    await page.setViewportSize({ width: 390, height: 844 })
    const beforeOff = await page.evaluate(
      () => window.__inventoryDb.movements.length,
    )
    await page.locator('.add-product-button').click()
    await page.getByRole('button', { name: 'Scansiona', exact: true }).click()
    await page.locator('.scanner-manual summary').click()
    await page.getByLabel('Barcode manuale').fill('96385074')
    await page
      .getByRole('button', { name: 'Cerca codice', exact: true })
      .click()
    await page
      .getByRole('heading', { name: 'Pasta OFF', exact: true })
      .waitFor()
    assert.equal(
      await page.evaluate(() => window.__inventoryDb.movements.length),
      beforeOff,
    )
    assert.equal(
      await page
        .getByRole('button', { name: 'Inserisci prodotto con questo barcode' })
        .count(),
      0,
    )
    assert.equal(
      await page.locator('.scanner-preview').evaluate((el) => el.clientHeight),
      88,
    )
    await page
      .getByRole('button', { name: 'Mostra anteprima', exact: true })
      .click()
    assert.ok(
      (await page
        .locator('.scanner-preview')
        .evaluate((el) => el.clientHeight)) >= 208,
    )
    await page
      .getByRole('button', { name: 'Riduci anteprima', exact: true })
      .click()
    // Simulate a stopped preview before saving: next must recover it automatically.
    await page.locator('.scanner-preview video').evaluate((video) => {
      video.pause()
      video.srcObject = null
    })
    await page
      .getByRole('button', { name: 'Modifica dati', exact: true })
      .click()
    await page.getByLabel('Nome', { exact: true }).fill('Pasta OFF corretta')
    await page
      .getByRole('button', { name: 'Conferma prodotto', exact: true })
      .click()
    await page.getByText(/Prodotto confermato\. Fotocamera attiva/).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Riprendi fotocamera' }).count(),
      0,
    )
    assert.ok(
      await page
        .locator('.scanner-preview video')
        .evaluate((video) => Boolean(video.srcObject)),
    )
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    const stoppedAfterSave = await page.evaluate(() => window.__trackStops)
    await page
      .getByRole('button', {
        name: 'Abilita nuova lettura dello stesso codice',
      })
      .click()
    await page.waitForTimeout(300)
    assert.equal(
      await page.evaluate(() => window.__trackStops),
      stoppedAfterSave,
    )
    assert.equal(
      await page
        .locator('.scanner-preview video')
        .evaluate((video) => video.srcObject),
      null,
    )
    await page.getByText(/Fotocamera sospesa/).waitFor()
    await page.getByRole('button', { name: 'Riprendi fotocamera' }).click()
    await page.getByText(/Fotocamera attiva/).waitFor()
    await page.getByRole('button', { name: 'Chiudi scanner' }).click()
    await page
      .getByRole('heading', { name: 'Pasta OFF corretta', exact: true })
      .waitFor()
    const imported = await page.evaluate(
      () => window.__inventoryDb.homeProducts.at(-1).entries[0],
    )
    assert.equal(imported.mode, 'unknown')
    assert.equal(imported.quantity, null)
    await page
      .locator('.add-panel')
      .getByRole('button', { name: 'Chiudi', exact: true })
      .click()
    await page.evaluate(() => {
      window.__role = 'viewer'
      window.__checkHomes()
    })
    await page.locator('.read-only-note').waitFor()
    assert.equal(await page.locator('.add-product-button').count(), 0)
    await page.evaluate(() => {
      window.__revoked = ['home-b']
      window.__checkHomes()
    })
    await page.getByRole('heading', { name: 'Pasta', exact: true }).waitFor()
    assert.equal(
      await page.getByRole('heading', { name: 'Sale', exact: true }).count(),
      0,
    )
    await page.evaluate(() => {
      window.__homeFailure = true
      window.__checkHomes()
    })
    await page.getByText(/Impossibile verificare gli accessi/).waitFor()
    assert.equal(await page.locator('.stock-page').count(), 0)
    await page.evaluate(() => {
      window.__homeFailure = false
    })
    await page.getByRole('button', { name: 'Riprova', exact: true }).click()
    await page.getByRole('heading', { name: 'Pasta', exact: true }).waitFor()
    await page.evaluate(() => {
      window.__revoked = ['home-a', 'home-b']
      window.__checkHomes()
    })
    await page
      .getByRole('heading', { name: 'Benvenuto a casa', exact: true })
      .waitFor()
    assert.equal(await page.locator('.stock-page').count(), 0)
    console.log(
      'PASS: rivalidazione periodica mantiene DOM e scanner; downgrade ruolo, revoca e errore rete rimuovono accesso',
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
