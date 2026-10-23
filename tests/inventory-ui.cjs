// Verifica UI browser con Supabase simulato in memoria: nessun account o DB remoto.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const base = 'http://127.0.0.1:5173/casetta/'
const longHomeName =
  'Casa condivisa con un nome volutamente lungo per i test mobile'
const mock = require('./supabase-ui-fixture.cjs')

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
      const originalClear = window.clearInterval
      const checks = new Map()
      window.__checkHomes = () => checks.forEach((callback) => callback())
      window.setInterval = (callback, ms, ...args) => {
        const id = originalInterval(callback, ms, ...args)
        if (ms === 30000) checks.set(id, callback)
        return id
      }
      window.clearInterval = (id) => {
        checks.delete(id)
        originalClear(id)
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
    await page.getByLabel('Nome', { exact: true }).evaluate((input) => {
      input.focus()
      input.closest('label').scrollIntoView({ block: 'start' })
    })
    assert.ok(
      await page
        .getByLabel('Nome', { exact: true })
        .evaluate(
          (input) =>
            input.closest('label').getBoundingClientRect().top >=
            document.querySelector('.scanner-sticky').getBoundingClientRect()
              .bottom,
        ),
    )
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
    await page.locator('.add-product-button').click()
    const callsBeforeEditorial = await page.evaluate(
      () => window.__offCalls || 0,
    )
    await page.getByRole('button', { name: 'Scansiona', exact: true }).click()
    await page.locator('.scanner-manual summary').click()
    await page.getByLabel('Barcode manuale').fill('9771125522005')
    await page
      .getByRole('button', { name: 'Cerca codice', exact: true })
      .click()
    await page.getByText(/Codice editoriale:/).waitFor()
    assert.equal(
      await page.evaluate(() => window.__offCalls || 0),
      callsBeforeEditorial,
    )
    await page
      .getByRole('button', { name: 'Inserisci prodotto con questo barcode' })
      .click()
    assert.equal(
      await page.getByLabel(/Codice a barre/).inputValue(),
      '9771125522005',
    )
    assert.equal(
      await page
        .locator('.add-panel')
        .getByLabel(/Categoria/)
        .inputValue(),
      'other',
    )
    assert.equal(await page.getByLabel(/Nome/).inputValue(), '')
    assert.equal(await page.getByLabel(/Marca/).inputValue(), '')
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
