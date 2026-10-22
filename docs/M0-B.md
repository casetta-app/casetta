# Consegna M0-B — 22 ottobre 2026

> Revisione successiva: [M0-B.1](M0-B.1.md) aggiorna ciclo di vita, migrazione e risultati PostgreSQL. I conteggi qui sotto registrano la consegna M0-B originaria.

## Checkout e ambito

Directory effettiva: `/Users/gianluigitarantino/Documents/Codex/casetta`.
Checkout principale, unico worktree, branch `main`, inizialmente pulito e allineato al riferimento locale `origin/main`, HEAD `0765074`. Nessun fetch richiesto: non si afferma una verifica aggiornata dello stato remoto.

Lette le due specifiche CASETTA v0.3 e il codice M0-A. Conservati React/TypeScript/Vite/HashRouter, la base Pages `/casetta/`, stile e navigazione Oggi/Scorte/Spesa/Gestione. Per questa milestone l’accesso richiesto è email/password con conferma email e PKCE. `home_members` sostituisce il nome concettuale `home_access` delle specifiche. Inviti futuri predisposti dalla membership revocabile e resident/guest; nessuna accettazione inviti o aggiunta arbitraria di membri.

## File creati

- `src/lib/supabase.ts`, `src/lib/storage.ts`: client centralizzato e preferenze locali.
- `src/auth/AuthContext.ts`, `AuthProvider.tsx`, `AuthPage.tsx`, `ProtectedApp.tsx`, `redirect.ts`, `completeCallback.ts`, `bootstrap.ts`: sessioni, login/registrazione/reinvio conferma, recupero/modifica password, callback e protezione rotte.
- `src/homes/HomeContext.ts`, `HomeProvider.tsx`, `HomeGate.tsx`, `CreateHomeForm.tsx`, `selection.ts`: appartenenze, selezione verificata, creazione idempotente e riconvalida.
- `src/pages/ManagementPage.tsx`: account e case.
- `supabase/migrations/202610220001_m0b_accounts_homes.sql`: schema, grant, RLS, trigger e RPC.
- `tests/auth-selection.test.ts`, `database.sql`, `local-auth-shim.sql`, `run-database.py`, `smoke-browser.cjs`: verifiche locali.
- `docs/M0-B.md`: questa consegna.

## File modificati

- `src/main.tsx`: avvio callback prima del router e nuove rotte.
- `src/shell/AppShell.tsx`: selettore case, ruoli e logout.
- `src/pages/TodayPage.tsx`: copy coerente con la casa collegata.
- `src/styles.css`: form e nuovi stati integrati nello stile esistente.
- `.env.example`, `README.md`: variabili pubbliche, configurazione, revisione e migrazioni.
- `package.json`, `pnpm-lock.yaml`: Supabase JS 2.118.0 e comandi test.
- `.github/workflows/deploy.yml`: lettura delle due variabili pubbliche durante la build. Il workflow non è stato avviato.

## Risultati delle verifiche locali

| Verifica                                                                                                         | Esito                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm typecheck`                                                                                                 | PASS                                                        |
| `pnpm lint`                                                                                                      | PASS, nessun warning                                        |
| `pnpm build`                                                                                                     | PASS                                                        |
| `pnpm test`                                                                                                      | PASS, 13 test                                               |
| PostgreSQL 17: migrazione su cluster temporaneo                                                                  | PASS                                                        |
| `pnpm test:db` / `python3 tests/run-database.py`                                                                 | PASS, 31 controlli SQL + 3 scenari concorrenti              |
| Chrome headless, viewport 390×844: configurazione assente, protezione rotta, refresh e pulizia callback recupero | PASS; nessun errore JS o overflow orizzontale               |
| Email reali, rinnovo/scadenza sessioni Supabase e logout tra dispositivi                                         | NON ESEGUITO: configurazione e utenti reali non disponibili |
| Safari su iPhone e PWA installata                                                                                | NON ESEGUITO: dispositivo reale non disponibile             |

I test SQL controllano utenti con case indipendenti, account con più case, membri nella stessa casa, viewer/editor, negazioni cross-home, profili privati, negazione DML diretto e RPC non autorizzate, revoca, ultimo owner, permessi su helper/trigger, account senza casa automatica, retry e rollback di una creazione con errore nel membro. Le fixture di condivisione sono inserite dal test come amministratore nel solo cluster temporaneo.

Le prove concorrenti usano connessioni PostgreSQL distinte: 8 chiamate alla creazione con stessa chiave danno una casa, 8 con chiavi diverse danno 8 case, 2 demozioni simultanee di owner lasciano un solo owner attivo. Il runner arresta e distrugge il proprio cluster in chiusura. Lo shim Auth locale simula solo la tabella utenti e `auth.uid()`, senza account o password fittizi e senza riprodurre l’intero servizio Supabase.

I 13 test frontend verificano query PKCE separate dall’hash, base e porta locali, URL Pages, pulizia parametri, instradamento recupero, singolo scambio prima del router, gestione di errori/verifier mancante e scelte per abitazione revocata. I test dello scambio usano una funzione stub: non dimostrano la consegna email o una sessione Supabase reale.

### Prova browser opzionale riproducibile

Con build senza variabili e preview attiva su `127.0.0.1:4173`, eseguire `node tests/smoke-browser.cjs` in un ambiente con Playwright già disponibile. Si può indicare un Chromium installato tramite `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Nel contesto Codex sono stati usati Playwright fornito dal runtime e Chrome già installato; nessun browser o servizio aggiuntivo è stato installato. Il test esclude il proxy per il collegamento a loopback. Questa prova non sostituisce la verifica Auth reale.

## Checklist reale da completare dopo configurazione e revisione

1. Applicare la migrazione secondo README, poi inserire solo URL e publishable key reali di Casetta in `.env.local`. Registrare due account reali autorizzati e confermare le email nello stesso browser di origine. Nessuna casa deve apparire prima della creazione esplicita.
2. Creare case separate e provare interrogazioni dirette con l’ID dell’altra: nessuna riga; nessun inserimento/update membership e nessuna promozione tramite RPC da viewer/editor.
3. Per verificare condivisioni prima di M4, predisporre membership solo con SQL amministrativo revisionato su utenti di test autorizzati; mai assegnare il ruolo dal frontend. Provare proprietario, editor e viewer.
4. Creare due case anche con lo stesso nome. Cambiare casa, ricaricare e rifare login: ultima casa solo se ancora autorizzata. Accedere con altro account: nessuna preferenza o dato dell’account precedente.
5. Revocare un membro tramite `manage_home_member` da un owner autorizzato. Alla query successiva nessuna riga; al focus/rientro o entro 30 secondi sparisce dalla UI. Provare anche revoca dell’ultima casa e indisponibilità rete: niente letture dalla vecchia cache.
6. Richiedere recupero password da sessione assente, aprire email nello stesso browser: `/casetta/?recovery=1&code=…` → `#/password`, senza codice residuo nella barra. Salvare una password valida; uscire, provare vecchia e nuova password. Ripetere con sessione già attiva e con link scaduto/già usato.
7. Provare conferma registrazione e reinvio email con link scaduto; codice aperto in browser diverso deve fallire con feedback recuperabile. Non inoltrare link o registrare codici/token nei log.
8. Provare refresh, chiusura/riapertura, scadenza access token e rinnovo automatico, perdita rete, sign-out e sessione revocata dal server. La UI deve tornare all’accesso o nascondere i dati quando non può verificare i permessi.
9. Ripetere su Safari iPhone e PWA: tastiera, form raggiungibili, selettore, refresh, email e storage separati. Registrare esito e dispositivo; non dichiarare conclusa la validazione mobile sulla base del solo test desktop.

## Sicurezza e limiti da conoscere

- Le garanzie DB sono verificate su PostgreSQL locale. Prima dell’uso reale controllare anche il progetto Supabase con Auth/PostgREST e i relativi grant di default. Le migrazioni remote non sono state applicate.
- Revoca subito efficace sulle query SQL successive, con aggiornamento UI periodico entro circa 30 secondi quando visibile. Non può cancellare informazioni già viste dall’utente.
- Le sessioni del browser sono persistenti: proteggere l’origine web da script non affidabili/XSS e usare solo HTTPS in produzione. Nessuna credenziale privilegiata nel frontend; nessuna cache offline di API private.
- Le chiavi di idempotenza sono conservate per utente anche dopo errori ambigui. Se lo storage non è disponibile o viene cancellato, la ripresa dopo ricaricamento non è garantita; non ripetere manualmente una creazione senza verificare l’elenco.
- Modifiche ai membri passano da RPC con controllo owner nel DB. La UI di inviti/ruoli è rimandata a M4. Nessun ripristino implicito di membri revocati tramite retry della creazione.
- Nella revisione M0-B.1 sono disponibili le RPC per trasferire proprietà ed eliminare la casa. La cancellazione fisica degli account è consentita quando non lascia case senza owner; vedere [M0-B.1](M0-B.1.md).

## Migrazione e impostazioni

Usare `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Conferma email attiva, password almeno 12 caratteri, Site URL e redirect esatti sotto `/casetta/` senza hash, recupero con `?recovery=1`, template `{{ .ConfirmationURL }}`. Il README contiene elenco completo e istruzioni SQL Editor/CLI dopo revisione, oltre alla procedura di ripristino.

Nessun commit, push, deploy, progetto Supabase nuovo, servizio a pagamento o funzionalità M1. Lavoro fermo alla M0-B, con verifiche reali ancora da completare come indicate sopra.
