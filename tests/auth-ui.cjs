// Verifica opzionale: Vite locale, Playwright disponibile, Auth interamente simulato.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const base = 'http://127.0.0.1:5173/casetta/'
const mock = `
const listeners = new Set();
const auth = {
  onAuthStateChange(callback) {
    listeners.add(callback);
    queueMicrotask(() => { if (listeners.has(callback)) callback('INITIAL_SESSION', null) });
    return { data: { subscription: { unsubscribe() { listeners.delete(callback) } } } };
  },
  async getSession() { return { data: { session: null }, error: null } },
  async signInWithPassword() {
    window.__authCalls.push({ operation: 'login' });
    await new Promise(resolve => setTimeout(resolve, 100));
    return { data: null, error: { code: window.__authScenario === 'login-invalid' ? 'invalid_credentials' : 'email_not_confirmed', status: 400, message: 'private-detail' } };
  },
  async signUp(options) {
    window.__authCalls.push({ operation: 'signup', redirect: options.options.emailRedirectTo });
    await new Promise(resolve => setTimeout(resolve, 100));
    switch (window.__authScenario) {
      case 'duplicate': return { data: null, error: { code: 'user_already_exists', status: 422, message: 'private-detail' } };
      case 'rate': return { data: null, error: { code: 'over_email_send_rate_limit', status: 429, message: 'private-detail' } };
      case 'network': return { data: null, error: { name: 'AuthRetryableFetchError', status: 0, message: 'private-detail' } };
      case 'thrown': throw new TypeError('private-detail');
      case 'server': return { data: null, error: { code: 'unexpected_failure', status: 500, message: 'private-detail' } };
      default: return { data: { user: { identities: [] }, session: null }, error: null };
    }
  }
};
export const supabase = { auth };
`

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-proxy-server'],
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  })
  let blockedExternal = 0
  try {
    let confirmationText
    let loginText
    for (const scenario of [
      'success',
      'duplicate',
      'rate',
      'network',
      'server',
      'thrown',
      'login-invalid',
      'login-unconfirmed',
    ]) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      })
      const diagnostics = []
      const failures = []
      page.on('console', (message) => diagnostics.push(message.text()))
      page.on('pageerror', (error) => failures.push(error.message))
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== new URL(base).origin) {
          blockedExternal++
          return route.abort()
        }
        if (
          url.pathname === '/casetta/src/lib/supabase.ts' ||
          url.pathname === '/src/lib/supabase.ts'
        )
          return route.fulfill({
            contentType: 'application/javascript',
            body: mock,
          })
        return route.continue()
      })
      await page.addInitScript((value) => {
        window.__authScenario = value
        window.__authCalls = []
      }, scenario)
      await page.goto(`${base}#/accedi`)
      if (!scenario.startsWith('login-'))
        await page
          .getByRole('button', { name: 'Crea account', exact: true })
          .click()
      await page
        .getByLabel('Email', { exact: true })
        .fill('test@example.invalid')
      await page
        .getByLabel('Password', { exact: true })
        .fill('local-form-input-only')
      // Due submit sincroni prima del prossimo render React: deve partire UNA richiesta.
      await page.locator('form').evaluate((form) => {
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        )
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        )
      })
      if (scenario === 'success' || scenario === 'duplicate') {
        const status = page.getByRole('status')
        await status.filter({ hasText: 'Richiesta ricevuta' }).waitFor()
        const text = await status.innerText()
        if (scenario === 'success') confirmationText = text
        else assert.equal(text, confirmationText)
        assert.equal(await page.getByRole('alert').count(), 0)
        assert.equal(
          await page.getByLabel('Password', { exact: true }).inputValue(),
          '',
        )
      } else {
        const alert = page.getByRole('alert')
        await alert.waitFor()
        const message = await alert.innerText()
        if (scenario.startsWith('login-')) {
          if (scenario === 'login-invalid') loginText = message
          else assert.equal(message, loginText)
        }
        assert.match(
          message,
          scenario === 'rate'
            ? /Troppe richieste/
            : scenario === 'network' || scenario === 'thrown'
              ? /esito/
              : scenario.startsWith('login-')
                ? /Accesso non riuscito/
                : /servizio di accesso/,
        )
        if (scenario === 'rate') {
          assert.equal(
            await page
              .getByRole('button', { name: 'Registrati', exact: true })
              .isDisabled(),
            true,
          )
          await page
            .locator('form')
            .evaluate((form) =>
              form.dispatchEvent(
                new Event('submit', { bubbles: true, cancelable: true }),
              ),
            )
        }
      }
      const calls = await page.evaluate(() => window.__authCalls)
      assert.equal(calls.length, 1)
      if (!scenario.startsWith('login-')) assert.equal(calls[0].redirect, base)
      assert.doesNotMatch(
        await page.locator('body').innerText(),
        /private-detail/,
      )
      assert.doesNotMatch(
        diagnostics.join('\n'),
        /private-detail|test@example|local-form-input-only/,
      )
      assert.deepEqual(failures, [])
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      )
      console.log(
        `PASS: UI ${scenario}, doppio invio bloccato, redirect /casetta/, diagnostica filtrata`,
      )
      await page.close()
    }
    assert.equal(
      blockedExternal,
      0,
      'La UI simulata non deve tentare chiamate esterne',
    )
    console.log(
      'PASS: zero chiamate esterne, nessun account creato o email inviata',
    )
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
