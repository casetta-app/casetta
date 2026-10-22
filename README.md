# Casetta — M0-B / revisioni M0-B.1 e M0-B.2

Account personali e abitazioni indipendenti sopra la shell M0-A esistente. React, TypeScript strict, Vite e HashRouter, base `/casetta/`. Oggi mantiene lo stato vuoto; Scorte e Spesa restano in preparazione. Gestione permette consultazione delle case e creazione. Inventario, scanner, acquisti e inviti non sono implementati.

## Avvio

Node.js **24+**, pnpm 11 e, per i test database, PostgreSQL 17 con `initdb`, `pg_ctl`, `psql` nel PATH e Python 3.

```sh
pnpm install
cp .env.example .env.local
# Compilare .env.local con i valori pubblici del progetto Supabase Casetta esistente.
pnpm dev
```

Aprire `http://localhost:5173/casetta/`. Senza configurazione valida appare un messaggio di configurazione; nessun dato dimostrativo o accesso fittizio. La build senza variabili resta valida, ma non consente login.

## Variabili e build Pages

- `VITE_SUPABASE_URL`: URL del progetto Supabase dedicato a Casetta.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: chiave **publishable** del medesimo progetto, prefisso `sb_publishable_`.

Sono valori pubblici incorporati nella build Vite: la sicurezza dei dati dipende da Auth, grant e RLS. Non usare secret key, `service_role`, vecchie chiavi JWT privilegiate o password database. `.env.local` è ignorato da Git. Il client rifiuta chiavi prive del prefisso publishable e URL non validi. I valori non sono inclusi nel repository.

Il workflow Pages legge le due **Repository variables** da **Settings → Secrets and variables → Actions → Variables** del repository. I nomi sono esattamente `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Configurarle a livello repository: il job di build non usa l’environment `github-pages` del job di deploy.

Entrambe vengono passate tramite `${{ vars.… }}` all’ambiente del job di build. `scripts/check-deploy-env.mjs` interrompe il job prima della build se mancano, se l’URL non è HTTPS del progetto o se la chiave non ha formato publishable. Non stampa i valori e non contatta Supabase. Seguono test frontend, typecheck, lint e build, poi l’upload dell’artefatto e il job Pages. Ogni variazione delle variabili richiede una nuova build; `.env.local` non viene caricato dal controllo CI e non va caricato su GitHub.

La configurazione del workflow è verificata localmente, ma questa revisione non ha avviato Actions né controllato i valori salvati nel repository remoto. Nessun commit, push o deploy eseguito. Diagnostica della registrazione, verifiche e limiti: [consegna M0-B.2](docs/M0-B.2.md).

## Stato Supabase e configurazione

Secondo la verifica comunicata dall’utente, la migrazione M0-B.1 è già applicata al progetto Casetta e registrazione, conferma email, login e persistenza della casa sono funzionanti. **Non rieseguire la migrazione iniziale sul database attuale.** M0-B.2 modifica soltanto frontend, test, workflow e documentazione; nessuna migrazione o email reale è stata eseguita. Le impostazioni seguenti restano il riferimento per il futuro frontend Pages.

Usare esclusivamente il progetto Casetta già creato.

1. Auth → Providers: abilitare email/password e **Confirm email**; disabilitare accessi anonimi se non necessari.
2. Auth → URL Configuration: Site URL `https://casetta-app.github.io/casetta/`.
3. Aggiungere i redirect autorizzati, **senza hash**:
   - `https://casetta-app.github.io/casetta/`
   - `https://casetta-app.github.io/casetta/?recovery=1`
   - `http://localhost:5173/casetta/`
   - `http://localhost:5173/casetta/?recovery=1`
   - Se si usa `pnpm preview`, anche gli equivalenti su `http://localhost:4173`.
4. Nei template **Confirm signup** e **Reset password** mantenere il link `{{ .ConfirmationURL }}`. Non sostituirlo con un link diretto a `SiteURL`: deve passare dal servizio di verifica Auth e conservare `RedirectTo` (inclusa `recovery=1`). Non usare template per flussi impliciti o callback in `#/...`.
5. Allineare la policy password a un minimo di **12 caratteri**. Per cambio password con opzione Supabase “Secure password change”, il servizio può richiedere una nuova autenticazione: effettuare nuovamente login prima del cambio. Non viene aggirata la policy server.
6. Verificare scadenze dei link, rate limit e limiti email del piano corrente. Configurare un mittente/SMTP autorizzato se necessario alla consegna agli utenti reali; nessun servizio è stato attivato o acquistato.
7. Conservare lo schema M0-B.1 già applicato. La [checklist M0-B](docs/M0-B.md) descrive i flussi reali: non ripetere registrazioni o invii email per diagnosticare un problema senza prima consultare gli esiti della richiesta originale.

## PKCE, HashRouter e recupero

`src/lib/supabase.ts` centralizza il client: `flowType: 'pkce'`, persistenza e rinnovo automatico della sessione, `detectSessionInUrl: false`.

Il ritorno email arriva a `/casetta/?code=...`, servibile da GitHub Pages. Prima di montare React e HashRouter, `bootstrapAuth` legge la query, rimuove i parametri Auth dalla barra degli indirizzi e invoca una sola volta `exchangeCodeForSession`. La conferma apre `#/oggi`; il recupero usa `/casetta/?recovery=1&code=...` e apre `#/password`. Il router non interpreta il codice come una rotta. Link scaduti, consumati o privi del verifier locale producono un errore leggibile. È possibile richiedere nuovamente l’email di conferma dalla registrazione.

Il link PKCE deve aprirsi nello **stesso browser e storage** da cui è partita la richiesta. Safari, browser dentro le app email e PWA installata possono avere storage distinti. Un link avviato dalla PWA e aperto in Safari può fallire: richiedere il link dal browser nel quale verrà aperto. Nessun fallback implicito che indebolisca PKCE. Non usare più richieste email simultanee: il verifier dell’ultima richiesta può sostituire quello precedente. Lo storage deve essere disponibile per mantenere sessione e verifier.

Le rotte riservate richiedono sessione. La preferenza dell’ultima casa è separata per user ID e ricontrollata con query RLS; non autorizza accessi. Logout riguarda la sessione sul dispositivo corrente. Il contenuto delle case viene riconvalidato al ritorno in primo piano, al focus, al ritorno online e ogni 30 secondi; durante la verifica è nascosto, in caso di errore è rimosso. La revoca nel database blocca subito le successive query: l’aggiornamento della UI in una scheda già aperta può richiedere fino al prossimo controllo (30 secondi). Il service worker non mette in cache API o dati privati.

## Database e sicurezza

Migrazione: `supabase/migrations/202610220001_m0b_accounts_homes.sql`.

- `profiles`: profilo privato creato dal trigger Auth, nessuna casa automatica. Solo il proprio profilo è leggibile; aggiornabile solo `display_name`.
- `homes`: nome, creatore, timestamp, chiave di creazione per utente. Nomi duplicati consentiti; identità basata sull’UUID.
- `home_members`: appartenenza molti a molti, ruoli owner/editor/viewer, resident/guest, timestamp e revoca. Corrisponde al concetto `home_access` delle specifiche; nome aggiornato alla richiesta M0-B. Nessuna tabella inviti fino a M4.
- Nessun grant di inserimento, aggiornamento o cancellazione diretta delle case e dei membri. RLS di lettura risolve il ruolo dal DB attraverso helper in schema `private`, senza ricorsione. Un membro legge i membri attivi della propria casa, senza esporre profili/email degli altri.
- `create_home(home_name, creation_key)`: crea atomicamente casa e owner; retry concorrenti con la stessa chiave restituiscono la stessa casa. Il frontend conserva la richiesta in sospeso per ritentare anche dopo refresh. Nomi e chiavi non cambiano durante un retry ambiguo.
- `manage_home_member(target_home, target_user, new_role, revoke_access)`: solo un owner attuale può modificare/revocare un membro attivo già esistente. Nessuna API client per aggiungere membri o riattivare accessi revocati. La gestione membri non è ancora esposta nella UI.
- Trigger e aggiornamento di `homes.membership_version` impediscono demozione/revoca/eliminazione dell’ultimo owner di una casa esistente, anche sotto concorrenza e con snapshot ripetibili. Le funzioni SECURITY DEFINER usano `search_path = ''`, riferimenti qualificati e grant espliciti. I trigger non sono invocabili direttamente da client.

Le autorizzazioni sono rilette nel database: i ruoli mostrati dalla UI non autorizzano scritture. Amministratori SQL e credenziali di servizio sono privilegiati per definizione: non vanno distribuiti al browser.

### Ciclo di vita M0-B.1

La migrazione esistente è stata corretta prima di qualsiasi applicazione remota:

- `homes.created_by` è una traccia storica facoltativa con `ON DELETE SET NULL`. Non rappresenta la proprietà attuale: decide `home_members.role` attivo.
- `home_members.user_id` usa `ON DELETE CASCADE`. L’eliminazione fisica dell’account Auth rimuove profilo e membership, comprese quelle revocate; conserva le case. Il trigger blocca e annulla tutta la cancellazione se l’account è ancora ultimo owner di almeno una casa. Prima di procedere, trasferire la proprietà di ciascuna casa interessata oppure eliminarla intenzionalmente.
- `transfer_home_ownership(target_home, target_user)` richiede un owner attivo e un destinatario già membro attivo della stessa casa: promuove il destinatario e rende editor il chiamante, atomicamente. Nessun trasferimento a estranei o revocati. Un nuovo membro potrà entrare solo tramite il futuro flusso inviti.
- `delete_home(target_home)` elimina atomicamente casa e tutte le membership; solo un owner attuale può invocarla. Il trigger distingue la rimozione dell’ultimo owner da una casa esistente dal cascade di una casa già eliminata nella stessa transazione. Nessun flag client consente di saltare i controlli.
- I futuri reinviti riuseranno la PK `(home_id, user_id)` con un aggiornamento privilegiato della riga revocata. `access_version` avanza a ogni modifica della membership: il futuro invito dovrà essere legato alla versione corrente per evitare riattivazioni da inviti precedenti alla revoca. Nessuna RPC di riattivazione è esposta oggi.

Non sono stati aggiunti pulsanti di cancellazione, un endpoint amministrativo Auth o il flusso inviti. La cancellazione fisica Auth dovrà passare dal servizio amministrativo attendibile, mai dal browser; il soft delete non attiva i trigger `DELETE` qui implementati. Per procedure, protocollo reinviti, test eseguiti e limiti: [revisione M0-B.1](docs/M0-B.1.md).

### Inizializzazione di un altro ambiente vuoto, dopo revisione

Questa è la procedura storica per un database ancora vuoto. Non applicarla nuovamente al progetto Casetta attuale, la cui migrazione è già stata applicata dall’utente.

1. Rivedere SQL e risultati dei test. Salvare un backup/snapshot dello schema del progetto Casetta. Verificare che non esistano già oggetti omonimi.
2. Nel **SQL Editor del solo progetto Casetta**, eseguire integralmente il file della migrazione, inclusi `begin` e `commit`, con il ruolo amministrativo di migrazione. Non eseguire i file `tests/*` sul progetto remoto.
3. Verificare tabelle, RLS, grant, trigger su `auth.users` e funzioni. Il trigger crea anche i profili degli utenti eventualmente già registrati.
4. Se si usa Supabase CLI per migrazioni tracciate, dopo aver controllato il project ref, collegare solo Casetta ed eseguire `supabase db push --dry-run`; applicare con `supabase db push` soltanto dopo la revisione. Scegliere un solo metodo e allineare la history CLI in caso di applicazione manuale.

La migrazione è transazionale: un errore prima del commit annulla le modifiche. Dopo applicazione con dati reali, usare una migrazione correttiva revisionata o ripristinare il backup; non cancellare tabelle per fare rollback. Su database locale usa e getta si ricrea il cluster con `pnpm test:db`.

## Verifiche

```sh
pnpm test
pnpm test:db
pnpm typecheck
pnpm lint
pnpm build
pnpm preview
```

`test:db` inizializza e distrugge un cluster PostgreSQL temporaneo esclusivamente su loopback, senza leggere URL Supabase o credenziali. Lo shim `auth.users`/`auth.uid()` è limitato ai test: verifica il comportamento PostgreSQL di grant, RLS, trigger e concorrenza, non il servizio Auth remoto. Risultati lifecycle aggiornati in [docs/M0-B.1.md](docs/M0-B.1.md); checklist email/Safari in [docs/M0-B.md](docs/M0-B.md).

## Diagnostica autenticazione M0-B.2

La conferma email richiesta è un esito normale della registrazione, anche con `session: null`. Risposte di account già esistente e registrazioni che richiedono conferma mostrano le stesse istruzioni neutrali, senza distinguere gli utenti tramite `identities` o ricerche aggiuntive. Recupero e reinvio mantengono la stessa tutela. Rate limit, esito di rete incerto, indisponibilità servizio e dati non validi hanno messaggi distinti; nessun testo grezzo del server viene mostrato.

Un lock sincrono impedisce due richieste dalla stessa schermata prima del prossimo render. Dopo un rate limit il form attende 60 secondi, senza ritentare automaticamente o inviare altre email. La pausa locale non sostituisce i limiti del server. In sviluppo la console riporta solo categoria, operazione, HTTP status e codici consentiti, mai email, password, token o oggetti di errore completi; i codici che rivelerebbero l’esistenza dell’account non sono riportati. In produzione questi log Casetta sono disabilitati.

## Struttura

`src/auth` identità e callback; `src/homes` accessi e selezione; `src/lib` client e preferenze; `src/pages` schermate; `src/shell` navigazione; `supabase/migrations` schema versionato; `tests` verifiche locali. L’ambito termina alla M0-B.
