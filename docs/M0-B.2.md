# M0-B.2 — Diagnostica registrazione e preparazione Pages

Directory effettiva `/Users/gianluigitarantino/Documents/Codex/casetta`, checkout principale sul branch `main`. Conservate le modifiche M0-B/M0-B.1 già presenti. La migrazione M0-B.1 è stata applicata dall’utente; non è stata modificata o riapplicata in questo incarico. Registrazione, conferma, login e casa persistente già funzionanti sono lo stato comunicato dall’utente, non risultati di nuove prove sul database reale.

## Causa accertata e ipotesi

È accertato nel codice precedente che il testo «Operazione non riuscita. Verifica i dati, la connessione o riprova tra qualche minuto.» proveniva dal ramo `result.error`, per quasi tutti i codici diversi da `invalid_credentials` ed `email_not_confirmed`. Il codice perdeva così la distinzione tra errori API, rate limit e errori di rete restituiti dal SDK. Il SDK installato può restituire un `AuthRetryableFetchError` in `result.error` invece di lanciare un’eccezione: il vecchio `catch` con messaggio di connessione non copriva questo caso.

Non è invece accertata la causa della richiesta originaria. Non sono disponibili status/codice della risposta originale, timestamp o log Auth correlati. L’esistenza dell’account e la ricezione dell’email non dimostrano che la risposta osservata dal browser fosse una risposta di successo.

| Caso                                       | Evidenza e interpretazione                                                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Successo con conferma email richiesta      | `error: null`, utente restituito, `session: null`. Era già trattato come successo; non è la causa dimostrata del messaggio generico. Test di regressione presente.                                                                                                 |
| Account già registrato o secondo tentativo | Supabase può restituire `user_already_exists`/`email_exists` oppure una risposta offuscata a seconda della configurazione. Prima, un codice di errore di questo tipo mostrava il testo generico. È un’ipotesi per l’episodio, non un fatto ricostruito.            |
| Rate limit                                 | `over_email_send_rate_limit`, `over_request_rate_limit` o HTTP 429 finivano nel testo generico. Può spiegare una richiesta successiva a un primo invio riuscito. Nessuna prova che il primo episodio fosse proprio un rate limit.                                  |
| Rete o risposta perduta                    | Un errore restituito dal SDK dopo l’invio può lasciare incerto l’esito lato client, anche se l’utente ha ricevuto l’email. Non si può concludere che l’account non sia stato creato.                                                                               |
| Servizio/API                               | HTTP 5xx, timeout o errori di invio del servizio erano poco distinguibili. La presenza dell’email non identifica quale richiesta o fase abbia fallito. Errori di validazione/password debole invece restano errori effettivi, non vengono trasformati in successi. |

La documentazione ufficiale conferma la semantica di [signUp e conferma email](https://supabase.com/docs/reference/javascript/auth-signup) e la distinzione tra [errori API e client Auth](https://supabase.com/docs/guides/auth/debugging/error-codes). Il controllo è stato fatto anche sul sorgente di `@supabase/auth-js` 2.118.0 già installato.

L’app chiama `signUp` dal submit del form: non c’è un effetto React che registri automaticamente. Non si attribuisce quindi il problema a StrictMode. Il precedente flag `busy` era aggiornato via state, senza un blocco sincrono per due submit nello stesso intervallo prima del render: è stato rafforzato, ma non è dimostrato che il problema reale fosse un doppio submit. Il callback PKCE si esegue al ritorno dal link email, non al momento del primo submit; non è stato modificato per correggere questo messaggio.

Per confermare retrospettivamente la causa occorrerebbe correlare timestamp, numero di richieste a `/signup`, HTTP status e codice Auth nei log della richiesta originale. Non occorre creare un altro account o ripetere invii email. Non allegare password, token, link completi di conferma o payload con dati personali.

## Correzioni

`src/auth/feedback.ts` centralizza la classificazione e restituisce esclusivamente messaggi e metadati consentiti:

- Registrazione riuscita senza sessione: istruzioni per la conferma email. Una sessione restituita indica accesso effettuato. Una risposta anomala senza utente e senza sessione non viene dichiarata riuscita.
- Account già esistente e risposta offuscata: stesso testo neutrale della conferma richiesta, senza controllare `identities`, email o database. Nessun messaggio «questa email è già registrata».
- Recupero e reinvio: stessa risposta pubblica per casi di account presente/assente. Login con credenziali non valide, account non trovato o email non confermata: istruzioni pubbliche uniformi.
- Rate limit: messaggio di attesa e pausa locale di 60 secondi, senza retry automatici. Il server conserva i propri limiti e può imporre un’attesa maggiore.
- Errori di rete/esito incerto: invito a controllare connessione ed eventuale email già ricevuta prima di ripetere la richiesta. HTTP 5xx viene classificato come indisponibilità del servizio anche se il SDK lo rappresenta come errore fetch retryable.
- Errori reali conosciuti: indicazioni per formato email/password, registrazione non disponibile, invio email non disponibile, CAPTCHA, nuova autenticazione o password invariata.
- Errori inattesi: messaggio prudente, senza dettagli interni del server. Nessuna lettura di `error.message` per costruire il testo visibile.

`AuthPage.tsx` usa questa classificazione sia per errori restituiti sia per eccezioni, impedisce richieste concorrenti tramite ref sincrono e non mostra un vecchio errore di sessione insieme a un nuovo esito riuscito. I metadati diagnostici sono disponibili solo in sviluppo, attraverso una lista di codici consentiti; errori grezzi, indirizzi, password, token, request ID e codici di esistenza account non vengono registrati da Casetta. Nessuna nuova telemetria.

Questa protezione evita informazioni aggiuntive di enumerazione nella UI; non modifica gli eventuali status, tempi o comportamenti delle API pubbliche Supabase. L’app non aggiunge sonde per verificare utenti. Un’eventuale protezione dagli abusi dell’API va configurata sul servizio, non affidata al countdown client.

## Preparazione workflow

`.github/workflows/deploy.yml` passa al job `build`:

```yaml
env:
  VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
  VITE_SUPABASE_PUBLISHABLE_KEY: ${{ vars.VITE_SUPABASE_PUBLISHABLE_KEY }}
```

Configurare le due **Repository variables** in **Settings → Secrets and variables → Actions → Variables** di `casetta-app/casetta`. L’URL è quello del progetto Casetta e la chiave deve essere publishable, prefisso `sb_publishable_`. Non usare secret key, service_role, JWT o valori provenienti da altri progetti. Non salvare `.env` nel repository. Il job build non è associato all’environment `github-pages` del job deploy: variabili definite solo in quell’environment non sono la configurazione richiesta qui.

Il nuovo controllo offline `scripts/check-deploy-env.mjs` richiede entrambe le variabili, HTTPS per il progetto senza credenziali/path/query/hash e formato publishable. Se fallisce interrompe il job prima della build, senza stampare valori e senza contattare Supabase. I test ne verificano anche gli exit code reali, con sentinelle di formato prive di validità su domini `.invalid`. Seguono `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, upload `dist` e deploy Pages. Riferimento: [variabili GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/variables).

La presenza e correttezza dei valori attualmente salvati su GitHub non è stata controllata. Non è stato avviato il workflow né effettuato un deploy. La validazione locale di YAML, riferimenti `vars`, ordine degli step e script non sostituisce un’esecuzione futura sul runner GitHub.

## Redirect produzione e PWA

Mantenuti base Vite `/casetta/`, HashRouter, PKCE, gestione callback prima del router, manifest, installazione e service worker.

| Flusso                 | URL di ritorno dal servizio                                | Rotta dopo scambio locale |
| ---------------------- | ---------------------------------------------------------- | ------------------------- |
| Conferma registrazione | `https://casetta-app.github.io/casetta/?code=…`            | `#/oggi`                  |
| Recupero password      | `https://casetta-app.github.io/casetta/?recovery=1&code=…` | `#/password`              |

In Supabase devono restare autorizzati `https://casetta-app.github.io/casetta/` e `https://casetta-app.github.io/casetta/?recovery=1`; i template devono conservare `{{ .ConfirmationURL }}`. I test verificano generazione degli URL, pulizia del codice, singolo scambio e instradamento sull’origine di produzione. Lo storage/verifier PKCE richiede lo stesso browser di origine.

Eseguite anche tre GET in sola lettura a GitHub Pages: base, query callback di conferma e query di recupero con un marcatore non valido come codice Auth. Tutte restituiscono HTTP 200 e HTML con asset sotto `/casetta/`. Le GET non eseguono JavaScript e non contattano Supabase: dimostrano che l’hosting serve quelle query, non una conferma email reale del nuovo codice. La versione aggiornata non è ancora pubblicata.

L’output `dist` è stato controllato per esistenza degli asset referenziati sotto `/casetta/`, scope/start URL del manifest e presenza del service worker corrispondente al sorgente. Nessuna modifica alla logica PWA o alle cache.

## Verifiche effettivamente eseguite

| Controllo                                                         | Esito                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm test`                                                       | PASS, 37 test: 15 feedback Auth, 13 regressioni redirect/selezione, 9 deploy/configurazione |
| `pnpm typecheck`                                                  | PASS                                                                                        |
| `pnpm lint`                                                       | PASS                                                                                        |
| `pnpm build`                                                      | PASS; avviso non bloccante per chunk di circa 509 kB, circa 150 kB gzip                     |
| YAML workflow, mapping variabili, ordine step, script validazione | PASS, verifiche locali incluse nella suite frontend                                         |
| Risorse statiche nell’output di produzione                        | PASS                                                                                        |
| GET hosting Pages base e query callback                           | PASS, 3 risposte HTTP 200                                                                   |
| UI Chrome headless 390×844 con client Auth simulato               | PASS, 8 scenari, zero richieste esterne della pagina                                        |

I test UI coprono successo con sessione nulla, account duplicato con testo identico, rate limit con blocco del form, errore fetch restituito, HTTP 500, eccezione fetch, credenziali non valide ed email non confermata con testo login identico. Due submit sincroni producono una sola chiamata simulata. Controllati anche redirect locale sotto `/casetta/`, assenza di errori JavaScript e overflow, password ripulita dopo successo e diagnostica priva dei dettagli privati della fixture. I casi login non hanno redirect email; il controllo della destinazione email riguarda i submit signup.

Per ripetere le verifiche base:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

La prova opzionale `node tests/auth-ui.cjs` richiede Vite su `127.0.0.1:5173`, Playwright già disponibile e Chromium oppure `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. In questo ambiente sono stati usati Playwright del runtime Codex e Chrome già installato. Il test sostituisce il modulo client prima del caricamento e blocca tutte le richieste non locali. Nessuna dipendenza o browser aggiuntivo installato.

Non eseguiti test SQL in questo incarico: schema e database non sono stati modificati. Non eseguita registrazione reale, reinvio email, recupero email reale, modifica di Casicali o riprova end-to-end del nuovo frontend pubblicato. Non vengono riattribuiti a questa revisione i test PostgreSQL della M0-B.1 o le verifiche reali comunicate dall’utente.

## File di questa revisione

Modificati: `src/auth/AuthPage.tsx`, `.github/workflows/deploy.yml`, `README.md`.

Creati: `src/auth/feedback.ts`, `scripts/check-deploy-env.mjs`, `tests/auth-feedback.test.ts`, `tests/deploy-config.test.ts`, `tests/auth-ui.cjs`, `docs/M0-B.2.md`.

Nessuna credenziale reale aggiunta ai sorgenti; fra i file `.env*` tracciati resta solo `.env.example`. Nessun commit, push, deploy o modifica a database remoto, LuLab Desk o JanSession. Fine incarico M0-B.2.
