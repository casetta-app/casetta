// Verifica opzionale della build senza configurazione Supabase.
// Richiede Playwright e Chromium (oppure PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH).
const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-proxy-server'],
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const base = 'http://127.0.0.1:4173/casetta/'
    await page.goto(`${base}#/gestione`)
    await page
      .getByRole('heading', { name: 'Collegamento da configurare' })
      .waitFor()
    if (!page.url().endsWith('#/accedi')) throw Error('Route not protected')
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error('Horizontal overflow')
    await page.reload()
    await page
      .getByRole('heading', { name: 'Collegamento da configurare' })
      .waitFor()
    await page.goto(`${base}?code=one-use&recovery=1`)
    await page
      .getByRole('heading', { name: 'Collegamento da configurare' })
      .waitFor()
    if (!page.url().endsWith('#/password') || page.url().includes('code='))
      throw Error('Recovery callback URL not cleaned')
    if (errors.length) throw Error(errors.join('\n'))
    console.log(
      'PASS: browser 390x844, configurazione mancante, rotta protetta, refresh, callback recupero, nessun overflow o errore JS',
    )
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
