// Controllo offline: non stampa valori e non contatta Supabase.
export function validateDeployEnv(env) {
  const problems = []
  const url = env.VITE_SUPABASE_URL?.trim()
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url)
    problems.push(
      'VITE_SUPABASE_URL mancante nelle variabili GitHub Actions del repository.',
    )
  else {
    try {
      const parsed = new URL(url)
      if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parsed.pathname !== '/'
      )
        throw new Error('Invalid URL')
    } catch {
      problems.push(
        'VITE_SUPABASE_URL deve essere un URL HTTPS del progetto, senza credenziali, percorsi o parametri.',
      )
    }
  }
  if (!key || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))
    problems.push(
      'VITE_SUPABASE_PUBLISHABLE_KEY mancante o non valida: usare esclusivamente una chiave publishable.',
    )
  return problems
}

import { pathToFileURL } from 'node:url'
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const problems = validateDeployEnv(process.env)
  if (problems.length) {
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  } else
    console.log(
      'Configurazione pubblica di produzione valida; nessuna richiesta remota eseguita.',
    )
}
