const longHomeName =
  'Casa condivisa con un nome volutamente lungo per i test mobile'
module.exports = `
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
  abortSignal() { return this; }
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
