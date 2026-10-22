# M0-B.1 — Revisione del ciclo di vita dei dati

Directory: `/Users/gianluigitarantino/Documents/Codex/casetta`, checkout principale, branch `main`. Le modifiche M0-B già presenti sono conservate. Il database remoto è ancora vuoto e non è stato interrogato o modificato: si corregge direttamente `supabase/migrations/202610220001_m0b_accounts_homes.sql`.

## Account e conservazione delle case

`homes.created_by` diventa nullable con `ON DELETE SET NULL`: l’identità del creatore è una traccia storica, mentre la proprietà corrente deriva esclusivamente da una membership attiva con ruolo owner. Eliminare il creatore non elimina l’abitazione né i suoi dati condivisi.

`home_members.user_id` diventa `ON DELETE CASCADE`; `profiles.user_id` conserva il cascade già presente. La cancellazione fisica da `auth.users` rimuove anche membership revocate, senza righe orfane. Il trigger privato `prepare_user_deletion` blocca in ordine di UUID le case interessate prima delle azioni referenziali. Il controllo sull’ultimo owner resta attivo durante il cascade dell’account: se anche una sola casa rimarrebbe senza proprietario, l’intera cancellazione fallisce con SQLSTATE `23514`, annullando anche rimozioni di profilo, membership di altre case e azzeramento di `created_by`.

Percorso consentito per un account che possiede case:

1. Per ogni casa da conservare, un owner attivo chiama `transfer_home_ownership(target_home, target_user)` verso un membro già attivo della stessa casa. La funzione promuove il destinatario prima di demuovere il chiamante a editor. Se una parte fallisce, entrambe le modifiche vengono annullate. Se la casa ha già altri owner si può anche demuovere/revocare il membro uscente con `manage_home_member`.
2. Se una casa deve essere eliminata intenzionalmente, un owner attuale chiama `delete_home(target_home)`.
3. Solo un servizio amministrativo attendibile può poi richiedere l’eliminazione fisica Auth. La migrazione non concede `DELETE` su `auth.users` al frontend e non implementa un endpoint amministrativo. Il vincolo del database ricontrolla comunque la situazione al momento della cancellazione.

Gli account senza case, editor/viewer e membri revocati non sono trattenuti da vincoli `RESTRICT`. Il trasferimento riguarda i ruoli, non cambia `created_by`. Non si assegnano automaticamente proprietà a membri scelti dal sistema e non si cancellano automaticamente case condivise durante l’eliminazione di un account.

## Eliminazione intenzionale di una casa

La RPC `delete_home(uuid)` è concessa solo al ruolo SQL authenticated; verifica nel database che `auth.uid()` sia un owner attivo della casa richiesta. Il helper privato controlla l’autorizzazione prima e dopo l’attesa sul lock della casa. Viewer, editor, estranei, revocati e anonimi sono rifiutati. Nessun ruolo frontend ha `DELETE` diretto sulle case.

La funzione elimina la riga di `homes` e lascia alla FK `home_members.home_id ON DELETE CASCADE` la rimozione dei membri nella stessa transazione. Durante tale cascade il trigger constata che la casa padre non esiste più nella transazione, quindi consente la rimozione anche dell’ultimo owner. Il medesimo trigger la nega se la casa esiste ancora. Nessuna variabile di sessione, ruolo dichiarato dal chiamante o parametro di bypass è consultato. Un errore durante il cascade annulla anche la cancellazione della casa.

Quando arriveranno tabelle domestiche nelle milestone successive, occorrerà progettare e testare per ciascuna FK la cancellazione, conservazione e/o archiviazione del contenuto. M0-B.1 copre le tre tabelle attuali e non anticipa inventario o acquisti.

## Membership revocate e reinviti futuri

Si conserva la PK `(home_id, user_id)`: una riga rappresenta lo stato corrente di quella relazione, anche quando revocata. Non occorre tentare un nuovo `INSERT` della medesima PK. `access_version`, inizialmente 1, è incrementata dal trigger a ogni UPDATE e non può essere forzata dal valore passato alla scrittura. Ogni revoca o riattivazione cambia quindi la versione corrente.

Il futuro flusso M4 dovrà rispettare il seguente protocollo, ancora NON implementato:

1. L’emissione di un invito deve essere autorizzata da un owner attuale e legata a casa, destinatario verificato, ruolo consentito e versione corrente della membership. Per un utente revocato si emette un nuovo invito dopo la revoca. Per destinatari non ancora risolti a un user ID, il legame/versionamento richiederà un’identità verificata o un vincolo server equivalente; non basta fidarsi dell’email dichiarata dal browser.
2. Una RPC di accettazione dedicata verifica `auth.uid()`, identità destinataria confermata, token hash, scadenza, revoca, stato e versione attesa. Il ruolo deriva dalla riga invito autorizzata, mai da parametri liberamente scelti dal destinatario. Gli inviti ordinari editor/viewer non promuovono a owner.
3. Sotto lo stesso lock della casa, si consuma una sola volta l’invito e si aggiorna la membership solo se ancora revocata e alla versione attesa: ruolo e relazione autorizzati, `revoked_at = NULL`, `joined_at` della nuova ammissione. Il trigger avanza `access_version`. Se manca una riga si inserisce la nuova membership attraverso la stessa procedura controllata.
4. Una membership già attiva non viene sovrascritta dal reinvito. Un invito consumato è idempotente; un invito riferito a una versione precedente viene rifiutato. Le future righe invito/evento conserveranno lo storico delle ammissioni: la riga membership da sola non è uno storico completo.

Oggi `manage_home_member` opera soltanto su membri attivi, `transfer_home_ownership` esige un destinatario attivo e non esiste una RPC di riattivazione. I test dell’UPDATE amministrativo dimostrano solo che la PK è riutilizzabile e la versione avanza; non dimostrano l’autorizzazione di un flusso inviti ancora assente.

## Concorrenza e sicurezza

Tutte le mutazioni membership scrivono `homes.membership_version` nel trigger. Questo serializza sul medesimo record le modifiche della stessa casa. A `REPEATABLE READ` o `SERIALIZABLE`, una transazione con snapshot precedente incontra un conflitto di serializzazione invece di contare owner che nel frattempo sono stati rimossi. La scelta di scrivere il record, oltre a bloccarlo, tiene conto delle [regole di isolamento PostgreSQL](https://www.postgresql.org/docs/17/transaction-iso.html).

RLS rimane attiva sulle tre tabelle pubbliche. Il lookup della membership nelle policy continua a usare un helper privato senza ricorsione. Restano assenti grant diretti di INSERT/UPDATE/DELETE delle case e delle membership. Nuove funzioni privilegiate con `search_path = ''`, riferimenti qualificati, EXECUTE revocato a PUBLIC/anon e helper non richiamabili dal client. Le sole nuove RPC esposte sono trasferimento e cancellazione casa.

## Verifiche statiche ed esecuzione PostgreSQL

La revisione statica ha riguardato FK, cammini di cascade, grant, policy, funzioni privilegiate, bypass e ordine dei lock. Tale revisione non viene conteggiata come test PostgreSQL superato.

La suite eseguita con `python3 tests/run-database.py` crea un cluster PostgreSQL **17.11 (Homebrew)** locale usa e getta, applica realmente la migrazione e utilizza lo shim Auth limitato ai test. Tutti i test elencati di seguito vengono eseguiti sul motore PostgreSQL: non sono ricerche di stringhe nei file SQL. Quattro verifiche interrogano il catalogo reale per RLS, grant e search_path; le altre eseguono operazioni, controllano risultati e verificano gli SQLSTATE attesi.

| Suite                                                    | Esito                                                    |
| -------------------------------------------------------- | -------------------------------------------------------- |
| `tests/database.sql`: regressione M0-B                   | PASS, 31 controlli SQL                                   |
| `tests/lifecycle.sql`: ciclo di vita e sicurezza         | PASS, 55 controlli SQL, incluse 4 verifiche del catalogo |
| Concorrenza M0-B: stessa chiave/chiavi diverse/demozioni | PASS, 3 scenari                                          |
| `tests/concurrency.py`: 7 corse × 3 isolamenti           | PASS, 21 scenari sincronizzati                           |
| `pnpm typecheck`                                         | PASS                                                     |
| `pnpm lint`                                              | PASS                                                     |
| `pnpm build`                                             | PASS                                                     |
| `pnpm test`                                              | PASS, 13 test frontend di regressione                    |

I test lifecycle coprono account senza case, membri revocati e attivi, ex owner dopo trasferimento, rollback di cancellazione account anche su più case, cancellazione multipla di account, negazione dell’ultimo owner, trasferimenti non autorizzati e a destinatari non validi, rollback della seconda parte del trasferimento, cancellazione intenzionale autorizzata, rifiuto per viewer/editor/estranei/revocati/anon, rollback di errori nel cascade, assenza di membership orfane e conservazione di case indipendenti.

Le sette corse sincronizzate sono: due demozioni RPC; due DELETE di membership; due cancellazioni account proprietari; due cancellazioni di proprietari che condividono due case; trasferimento contro cancellazione del destinatario; trasferimento contro eliminazione della casa; cancellazione account contro eliminazione della casa da un co-owner. Ciascuna viene ripetuta a `READ COMMITTED`, `REPEATABLE READ`, `SERIALIZABLE`. Una barriera basata su advisory lock conferma che entrambe le connessioni hanno acquisito lo snapshot prima di procedere. Dopo ogni corsa si verificano anche assenza di case senza owner e assenza di membership orfane. Gli errori attesi sono controllati per SQLSTATE: non basta che una query fallisca per un motivo qualsiasi.

## Limiti e rischi residui

- Non eseguite chiamate al progetto Supabase remoto o al servizio Auth reale. Lo shim locale verifica PostgreSQL, non replica l’implementazione completa del servizio Auth, PostgREST, le sessioni o Supabase Storage.
- L’integrazione di eliminazione account deve usare la cancellazione fisica. Il [soft delete Auth](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser) non è una DELETE SQL della riga e non attiva i cascade/trigger di questa procedura. Un eventuale percorso soft delete dovrà revocare esplicitamente gli accessi e affrontare separatamente le stesse garanzie.
- L’ultimo owner di una casa da conservare deve trasferire la proprietà a un membro attivo oppure aggiungere un nuovo membro tramite il futuro flusso autorizzato. Senza un destinatario attivo, può eliminare intenzionalmente la casa; non è prevista alcuna promozione automatica.
- Conflitti di serializzazione (`40001`) e possibili deadlock (`40P01`) sotto carichi/operazioni amministrative più ampi richiedono il retry dell’intera transazione con rilettura dei permessi. Nei 24 scenari eseguiti non sono ammessi deadlock come successo: gli stati delle transazioni fallite sono controllati esplicitamente.
- Operazioni amministrative che disabilitano trigger, bypassano il protocollo o usano TRUNCATE non fanno parte delle API garantite. Le credenziali amministrative restano esclusivamente server.
- UI di trasferimento/cancellazione, servizio amministrativo account, inviti e audit storico sono ancora da realizzare nelle rispettive milestone; non vengono presentati come disponibili all’utente dell’app.

## Applicazione dopo revisione

Il file di migrazione esistente può essere applicato integralmente soltanto dopo revisione sul progetto Casetta vuoto, seguendo il README. Non applicare lo shim o i test a un database remoto. Se una versione precedente fosse stata applicata altrove, questa revisione non è un aggiornamento incrementale: servirà una migrazione ALTER dedicata e revisionata.

File di questa revisione: migrazione esistente, `tests/lifecycle.sql`, `tests/concurrency.py`, `tests/run-database.py`, `README.md`, `docs/M0-B.md` e questa documentazione. Nessun commit, push, deploy o modifica ad altri progetti.
