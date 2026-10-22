import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { validateDeployEnv } from '../scripts/check-deploy-env.mjs'

// Solo sentinelle locali per la validazione del formato: non sono credenziali utilizzabili.
const publicFormat = {
  VITE_SUPABASE_URL: 'https://project.invalid',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_format_test_only',
}
test('configurazione produzione richiede entrambe le variabili', () => {
  assert.equal(validateDeployEnv({}).length, 2)
  assert.equal(
    validateDeployEnv({ VITE_SUPABASE_URL: publicFormat.VITE_SUPABASE_URL })
      .length,
    1,
  )
})
test('formato pubblico valido, nessuna chiamata remota necessaria', () => {
  assert.deepEqual(validateDeployEnv(publicFormat), [])
})
test('produzione rifiuta URL HTTP, credenziali, percorsi, query e hash', () => {
  for (const url of [
    'http://localhost:54321',
    'not-a-url',
    'https://name:password@project.invalid',
    'https://project.invalid/rest/v1',
    'https://project.invalid/?value=private',
    'https://project.invalid/#private',
  ])
    assert.equal(
      validateDeployEnv({ ...publicFormat, VITE_SUPABASE_URL: url }).length,
      1,
    )
})
test('rifiuta secret, JWT e publishable vuota senza stamparne valori', () => {
  for (const key of [
    'sb_secret_private',
    'eyJ.private',
    'sb_publishable_',
    'sb_publishable_invalid value',
  ]) {
    const problems = validateDeployEnv({
      ...publicFormat,
      VITE_SUPABASE_PUBLISHABLE_KEY: key,
    })
    assert.equal(problems.length, 1)
    assert.equal(problems.join('').includes(key), false)
  }
})
test('controllo CLI fallisce con variabili assenti e non carica .env.local', () => {
  const env = {
    ...process.env,
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_PUBLISHABLE_KEY: '',
  }
  const result = spawnSync(process.execPath, ['scripts/check-deploy-env.mjs'], {
    env,
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /VITE_SUPABASE_URL/)
  assert.match(result.stderr, /VITE_SUPABASE_PUBLISHABLE_KEY/)
})
test('workflow usa variabili repository, verifica configurazione e test prima di build/upload', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8')
  assert.match(
    workflow,
    /VITE_SUPABASE_URL: \$\{\{ vars\.VITE_SUPABASE_URL \}\}/,
  )
  assert.match(
    workflow,
    /VITE_SUPABASE_PUBLISHABLE_KEY: \$\{\{ vars\.VITE_SUPABASE_PUBLISHABLE_KEY \}\}/,
  )
  const steps = [
    'node scripts/check-deploy-env.mjs',
    'pnpm test',
    'pnpm typecheck',
    'pnpm lint',
    'pnpm build',
    'actions/upload-pages-artifact@',
  ]
  const positions = steps.map((step) => workflow.indexOf(step))
  assert.equal(
    positions.every(
      (pos, index) => pos >= 0 && (index === 0 || pos > positions[index - 1]),
    ),
    true,
  )
  assert.doesNotMatch(workflow, /service_role|sb_secret_|sb_publishable_/)
})
test('base e risorse PWA restano sotto /casetta/', () => {
  assert.match(readFileSync('vite.config.ts', 'utf8'), /base: '\/casetta\/'/)
  const manifest = JSON.parse(
    readFileSync('public/manifest.webmanifest', 'utf8'),
  )
  assert.equal(manifest.start_url, '/casetta/')
  assert.equal(manifest.scope, '/casetta/')
  assert.match(readFileSync('src/main.tsx', 'utf8'), /HashRouter/)
  assert.match(readFileSync('src/lib/supabase.ts', 'utf8'), /flowType: 'pkce'/)
  assert.match(readFileSync('src/main.tsx', 'utf8'), /BASE_URL}sw\.js/)
})

test('workflow YAML sintatticamente valido', async () => {
  const { format } = await import('prettier')
  await format(readFileSync('.github/workflows/deploy.yml', 'utf8'), {
    parser: 'yaml',
  })
})

test('controllo CLI accetta solo il formato pubblico e non stampa i valori', () => {
  const result = spawnSync(process.execPath, ['scripts/check-deploy-env.mjs'], {
    env: { ...process.env, ...publicFormat },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  assert.equal(result.stdout.includes(publicFormat.VITE_SUPABASE_URL), false)
  assert.equal(
    result.stdout.includes(publicFormat.VITE_SUPABASE_PUBLISHABLE_KEY),
    false,
  )
})
