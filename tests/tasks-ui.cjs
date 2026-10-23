// Real React UI, deterministic in-memory backend; PostgreSQL is tested separately.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const mock = require('./supabase-ui-fixture.cjs')
const base = 'http://127.0.0.1:5173/casetta/'
const taskAdapter = `
export {pendingKey,persistCommand,restoreCommand,taskError} from '/casetta/src/tasks/api.ts?real';
const db=JSON.parse(sessionStorage.getItem('task-db')||'[]');
const ledger=new Set(JSON.parse(sessionStorage.getItem('task-ledger')||'[]'));
export async function loadTasks(user,home){return db.filter(t=>t.owner_user_id===user || t.home_id===home).map(t=>({...t}))}
export async function executeTask(c){
 if(!ledger.has(c.key)){
 const a=c.args;
 if(c.rpc==='create_domestic_task') db.push({id:c.key,owner_user_id:a.p_home?null:'user-a',home_id:a.p_home,title:a.p_title,kind:a.p_kind,importance:a.p_importance,state:'open',source:'user_declared',timezone:a.p_timezone,due_local:a.p_due,due_at:a.p_due?new Date(a.p_due+'Z').toISOString():null,version:1});
 else {const t=db.find(t=>t.id===a.p_task);t.state=({complete:'completed',snooze:'snoozed',start:'in_progress',cancel:'cancelled',confirm:'open'})[a.p_action];t.version++;if(a.p_until)t.snoozed_until=new Date(a.p_until+'Z').toISOString()}
 ledger.add(c.key);sessionStorage.setItem('task-db',JSON.stringify(db));sessionStorage.setItem('task-ledger',JSON.stringify([...ledger]));
 }
 if(window.__loseReply){window.__loseReply=false;throw Error('Risposta persa: riprova')}
}
`
;(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.route('**/*', (r) => {
      const u = new URL(r.request().url())
      if (u.origin !== new URL(base).origin) return r.abort()
      if (u.pathname.endsWith('/src/lib/supabase.ts'))
        return r.fulfill({ contentType: 'application/javascript', body: mock })
      if (
        u.pathname.endsWith('/src/tasks/api.ts') &&
        !u.searchParams.has('real')
      )
        return r.fulfill({
          contentType: 'application/javascript',
          body: taskAdapter,
        })
      return r.continue()
    })
    await page.goto(base + '#/oggi')
    await page.getByRole('heading', { name: 'Oggi', exact: true }).waitFor()
    await page
      .getByRole('button', { name: 'Aggiungi attività o scadenza' })
      .click()
    await page.getByLabel('Cosa devi fare?').fill('Prenotare controllo')
    await page.evaluate(() => (window.__loseReply = true))
    await page
      .getByRole('button', { name: 'Registra attività', exact: true })
      .click()
    await page.getByRole('button', { name: 'Riprova richiesta' }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: 'Riprova richiesta' }).click()
    await page
      .getByRole('heading', { name: 'Prenotare controllo', exact: true })
      .waitFor()
    assert.equal(
      await page
        .getByRole('heading', { name: 'Prenotare controllo', exact: true })
        .count(),
      1,
    )
    await page.goto(base + '#/agenda')
    await page.getByRole('heading', { name: 'Agenda', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Rinvia', exact: true }).click()
    await page.getByLabel(/Riprendi il/).fill('2090-01-01T09:00')
    await page.getByRole('button', { name: 'Conferma rinvio' }).click()
    await page.getByText('Rinviata', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Fatto', exact: true }).click()
    await page.getByText('Mostra anche concluse').click()
    await page.getByText('Completata', { exact: true }).waitFor()
    await page
      .getByRole('button', { name: 'Aggiungi attività o scadenza' })
      .click()
    await page.getByLabel('Cosa devi fare?').fill('Casa A')
    await page.getByLabel('Visibilità').selectOption('home')
    await page
      .getByRole('button', { name: 'Registra attività', exact: true })
      .click()
    await page.getByRole('heading', { name: 'Casa A', exact: true }).waitFor()
    await page.getByLabel('Cambia abitazione').selectOption('home-b')
    await page
      .getByRole('heading', { name: 'Casa A', exact: true })
      .waitFor({ state: 'detached' })
    await page.getByLabel('Cambia abitazione').selectOption('home-a')
    await page.getByRole('heading', { name: 'Casa A', exact: true }).waitFor()
    await page.evaluate(() => {
      window.__role = 'viewer'
      window.dispatchEvent(new Event('focus'))
    })
    await page.getByRole('heading', { name: 'Casa A', exact: true }).waitFor()
    await page.waitForTimeout(200)
    const card = page.locator('article').filter({
      has: page.getByRole('heading', { name: 'Casa A', exact: true }),
    })
    assert.equal(
      await card.getByRole('button', { name: 'Fatto', exact: true }).count(),
      0,
    )
    await page.evaluate(() => {
      window.__revoked = ['home-a']
      window.dispatchEvent(new Event('focus'))
    })
    await page
      .getByRole('heading', { name: 'Casa A', exact: true })
      .waitFor({ state: 'detached' })
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    )
    await page.setViewportSize({ width: 1280, height: 900 })
    assert.deepEqual(errors, [])
    const personalPage = await browser.newPage({
      viewport: { width: 390, height: 844 },
    })
    await personalPage.route('**/*', (r) => {
      const u = new URL(r.request().url())
      if (u.origin !== new URL(base).origin) return r.abort()
      if (u.pathname.endsWith('/src/lib/supabase.ts'))
        return r.fulfill({
          contentType: 'application/javascript',
          body: mock.replace(
            /const homes = \[[\s\S]*?\];/,
            'const homes = [];',
          ),
        })
      if (
        u.pathname.endsWith('/src/tasks/api.ts') &&
        !u.searchParams.has('real')
      )
        return r.fulfill({
          contentType: 'application/javascript',
          body: taskAdapter,
        })
      return r.continue()
    })
    await personalPage.goto(base + '#/oggi')
    await personalPage
      .getByRole('button', { name: 'Aggiungi attività o scadenza' })
      .click()
    await personalPage
      .getByLabel('Cosa devi fare?')
      .fill('Personale senza casa')
    assert.equal(
      await personalPage.getByLabel('Visibilità').locator('option').count(),
      1,
    )
    await personalPage
      .getByRole('button', { name: 'Registra attività', exact: true })
      .click()
    await personalPage
      .getByRole('heading', { name: 'Personale senza casa', exact: true })
      .waitFor()
    await personalPage.close()
    console.log(
      'PASS: attività UI mobile/desktop, create, risposta persa/reload/retry, rinvio, completamento, cambio casa, viewer e revoca',
    )
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
