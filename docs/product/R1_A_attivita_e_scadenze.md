# R1-A — Prima delega operativa: attività e scadenze

Riferimento vincolante: CASETTA_specifica_v0.5.md e audit R0. R1-A è un segmento di R1, non la V1 e non un ridimensionamento dell'assistente.

## Realizzato

Creazione rapida da Oggi/Agenda senza prodotti e senza obbligo di abitazione: titolo, data facoltativa, importanza, personale/casa. Dettagli espandibili per tipo, ora locale, fuso e ricorrenza. Ambito personale predefinito, mai condivisione implicita. Oggi ordina dati persistenti per attenzione scaduta, date da verificare, resto; a pari gruppo importanza, data e identificativo stabile. Agenda permette rinvio, inizio, completamento, annullamento e consultazione delle concluse. Rimangono Scorte, Spesa e Gestione; lo scanner è contestuale alle scorte.

Nessun indicatore di notifica inviata. L'interfaccia dichiara esplicitamente che gli avvisi esterni NON sono attivi. Un piano tecnico non è una subscription e non è una garanzia di consegna.

## Schema, visibilità e provenienza

Migrazione nuova `202610230005_r1a_tasks.sql`, esclusivamente additiva. Nessun cambiamento alle 001–004.

- `domestic_tasks`: responsabilità/occorrenza con proprietario personale XOR casa, titolo, tipo, importanza, stato, fonte, data locale, istante UTC, fuso IANA, regola, ancoraggio, indice e predecessore univoco. Scope immutabile via API. `created_by` non determina l'accesso ai dati condivisi.
- `task_events`: storico append-only delle transizioni, attore, versione e timestamp; prima registrazione e generazione delle occorrenze incluse. Non è una tabella universale per ogni evento futuro della casa.
- `task_reminder_plans`: stato tecnico di arresto dei solleciti; inizialmente disabilitato. Nessun worker o comando pubblico per attivarlo in R1-A.
- `private.task_commands`: registro chiave/attore, firma dell'input e risultato; niente payload domestico universale JSON. L'hash JSON usato internamente serve solo a confrontare parametri tipizzati, non a memorizzare il dominio.

RLS su tutte le tabelle. Personale visibile e modificabile solo dal titolare, anche quando questi è viewer nella casa. Casa leggibile da tutti i membri attivi; scritture solo owner/editor. Estranei, altra casa e anonimi esclusi. Nessun INSERT/UPDATE/DELETE diretto a authenticated; soltanto RPC con search_path vuoto, grant minimi e controlli server. Le RPC controllano il ruolo anche prima di restituire un risultato idempotente. Mutazioni condivise e revoche serializzate sul lock della casa; task bloccato prima della transizione.

Fonte iniziale `user_declared`; occorrenza successiva `recurrence_rule`, mai dato documentale certo. Gli UUID di attività/eventi costituiscono punti di collegamento per future tabelle con FK esplicite verso documenti, soggetti/bene/veicolo/utenza, eventi di pagamento/intervento e fatti di memoria. Non sono state inventate tabelle vuote per tali domini, né UUID senza FK che fingano collegamenti già disponibili. I documenti personali futuri non erediteranno automaticamente la visibilità della casa.

Cancellazione account: attività personali in cascade; dati condivisi conservati, autore storico nullable. Eliminazione autorizzata della casa: cascade delle sue sole attività/eventi. Nessuna influenza su catalogo, scorte o storico dei movimenti.

## Macchina a stati

- Creazione: `open`.
- `open`, `in_progress`, `snoozed`: possono passare a in_progress, snoozed, completed, cancelled.
- `needs_verification`: solo conferma esplicita → open, oppure cancelled.
- `completed` e `cancelled`: terminali; una ripetizione con stessa chiave restituisce il risultato già registrato, non ripete la transizione.
- `overdue` è derivato dalla data, non uno stato memorizzato. Il rinvio cambia snoozed_until (attenzione), non la scadenza originaria, che resta visibile.

Solo completamento e annullamento arrestano definitivamente il piano dell’occorrenza: impostano enabled=false e stopped_at atomicamente. start e confirm non cambiano il piano; snooze non lo arresta né lo attiva, ma rinvia l’attenzione tramite domestic_tasks.snoozed_until. Il futuro motore dovrà escludere ogni sollecito prima di tale istante, senza confonderlo con una chiusura. Il futuro motore di consegna dovrà verificare stato/versione al momento dell'invio e serializzarsi con la chiusura: R1-A non pretende di fermare un worker non ancora implementato.

## Ricorrenze e date

- `none`: nessun successore.
- `confirmed_date`: data dichiarata certa, nessun rinnovo inferito al completamento. Una nuova data richiede nuova registrazione confermata/documento futuro.
- `calendar`: intervallo dichiarato in giorni/settimane/mesi/anni, calcolato dall'ancora iniziale + indice. 31 gennaio → ultimo febbraio → 31 marzo, senza deriva al 28 marzo; 29 febbraio annuale si adatta all'ultimo giorno disponibile.
- `after_completion`: intervallo dalla data/ora effettiva dell'intervento registrata dal server, non dalla vecchia scadenza.

Il completamento crea al massimo UN successore, con `needs_verification`. Non certifica mai una nuova scadenza normativa. Occorrenze arretrate non vengono saltate automaticamente. Le date possono essere rifiutate/annullate; l'editing in-place di titolo/data/regola già registrati non è incluso: per una correzione in R1-A annullare la voce e registrare quella corretta, conservando lo storico.

Timestamp locale e fuso sono conservati separatamente dall'istante timestamptz. Ora iniziale UI 09:00 esplicita e modificabile. Il DB verifica il fuso IANA. Ora primaverile inesistente rifiutata; ora autunnale ripetuta interpretata come ora standard (politica PostgreSQL, indicata nel form). Un successore che cade nel gap viene spostato al corrispondente orario valido, sempre da verificare. I calcoli mantengono l'ora locale attraverso DST; non usano 24h come sinonimo universale di giorno di calendario. Intervalli massimi 120 unità; date di input finite nell'intervallo anni 1–9999.

## Rete, idempotenza e revoche

Le RPC `create_domestic_task` e `act_on_domestic_task` sono transazioni singole. Chiave UUID per comando, scope attore, input identico richiesto per retry, versione attesa per modifiche. Doppio click bloccato dal ref sincrono UI; chiave persistita PRIMA dell'invio nel localStorage separato per account/casa. Storage non disponibile: nessuna richiesta inviata. Risposta persa: stesso comando riprendibile dopo reload. Timeout client a 15 secondi: un annullamento della richiesta non prova il rollback server; resta la stessa chiave per il retry. Nessuna sincronizzazione silenziosa o promessa di scrittura offline.

Errori 40001 richiedono rilettura: stessa chiave se si tratta di esito perso; nuova intenzione/versione solo dopo riconciliazione. Snapshot ripetibili possono non vedere il ledger concorrente: unique_violation viene convertita in 40001 e l'intera transazione è annullata. Nessun task parziale.

Una richiesta pending può essere abbandonata esplicitamente dopo rilettura; questo NON annulla una scrittura ricevuta dal server e l'UI lo dichiara. Il registro server impedisce retry doppi finché account/task esistono. La coda locale contiene titolo e parametri privati; resta sul dispositivo fino a successo o abbandono esplicito. Non usare un browser condiviso senza chiudere la sessione e rimuovere i dati locali. Retention centralizzata delle bozze e strumenti di gestione dispositivo restano da completare in R1.

Rivalidazione attività a 30s/focus/online/visibility, senza sostituire il DOM durante le verifiche ordinarie; errore di lettura nasconde i dati precedenti. Cambio casa/ruolo resetta il workspace e invalida risposte tardive. HomeGate continua a bloccare l'accesso su errore membership. Revoca è immediata lato database; dati già visualizzati possono restare fino al successivo controllo membership (massimo 30s a pagina visibile), come per la base esistente. Nessun polling in background dichiarato servizio di notifiche.

## Protocollo SQL e collaudo (operazioni manuali, NON eseguite da questo incarico)

1. Revisionare il diff e la migrazione 005; verificare sul progetto Casetta che 001–004 risultino applicate. Non rieseguire quelle migrazioni. Verificare backup aggiornato di DB/Auth e relativo ripristino su ambiente isolato prima dell'attivazione.
2. Eseguire localmente `pnpm test:db`: crea/distrugge un cluster dedicato, applica tutte le migrazioni e prova RLS/ricorrenze/concorrenza. Non usa URL remoti.
3. In un ambiente Supabase di collaudo autorizzato, applicare SOLO il contenuto integrale di `supabase/migrations/202610230005_r1a_tasks.sql` tramite SQL Editor (include BEGIN/COMMIT), oppure `psql "$DATABASE_URL_DI_COLLAUDO" -X -v ON_ERROR_STOP=1 -f supabase/migrations/202610230005_r1a_tasks.sql`. Non usare URL di produzione durante il collaudo locale. Aggiornare lo schema cache PostgREST con `NOTIFY pgrst, 'reload schema';` se necessario.
4. Usare account autorizzati di collaudo (non Casicali) e due case isolate: owner/editor/viewer/estraneo. Aprire `#/oggi`, registrare attività personale senza prodotti; ricaricare. Registrare una condivisa e verificarne visibilità; viewer legge ma non modifica la condivisa, può gestire le proprie personali.
5. In `#/agenda`: rinviare senza cambiare data originaria, completare, mostrare concluse, controllare il piano disabilitato. Per calendario usare 31/1/2028 mensile; per post-completamento vecchia data iniziale; per data certa nessuna nuova scadenza. Confermare/annullare la proposta successiva.
6. Simulare risposta persa/assenza rete dopo invio, ricaricare e usare Riprova richiesta: una sola creazione/transizione/successore. Cambiare casa durante lettura o invio; revocare la membership e verificare sparizione e diniego DB. Non applicare gli script fixture a database reali.
7. Safari/PWA iPhone: tastiera, layout 390×844, controlli touch, date/fusi, chiusura/ripresa, logout e cambio account. Non considerare collaudati push o calendario Apple: non implementati qui.
8. Solo dopo accettazione autorizzare eventuale attivazione in produzione, migrazione prima del frontend. Nessuna Edge Function nuova, chiave o servizio a pagamento necessario a R1-A. Senza 005 l'UI mostra un errore esplicito e non inventa dati.

Rollback applicativo: ripristinare il precedente frontend lasciando le nuove tabelle intatte e private. La migrazione è transazionale: un errore iniziale annulla la 005. Non fare DROP delle nuove tabelle per un rollback dopo che sono stati registrati dati; esportare e pianificare una migrazione correttiva additiva. Nessun rollback/distruzione automatica preparato.

## Cosa manca a R1 completo e requisiti V1

R1 richiede ancora onboarding adattivo, voce verificata, collegamento documentale reale, motore avvisi affidabile con app chiusa/inattività e calendario iPhone con token revocabile e limiti collaudati. Editing versionato e strumenti di retention/export vanno completati. Lo spike notifiche e lo spike OCR scontrini dell'audit R0 restano obbligatori: nessuna loro fattibilità è dedotta da questi test.

R2–R5 e tutti i moduli V1 restano vincolanti: acquisizione documenti/originali privati, OCR e review, voce, scontrini con riepilogo unico, economia/prezzi, lista spesa, memoria collegata, apprendimento contestuale e offerte pertinenti. R1-A non li sostituisce con un calendario o un inventario migliorato.

## Risultati effettivi di questo intervento

- `pnpm test`: 71 test Node passati, inclusi ordinamento attività, rinvio, stati e visualizzazione date nei fusi attraverso DST.
- `pnpm test:db`: PostgreSQL 17.11 locale temporaneo, 257 controlli SQL (48 R1-A, di cui 19 aggiunti nella revisione dei piani) e 66 scenari concorrenti totali (9 nuovi R1-A, 57 preesistenti). RLS proprietario personale/owner/editor/viewer/estraneo/altro scope/anonimo, revoca, idempotenza, conflitti, anno bisestile e DST eseguiti realmente su PostgreSQL. Il test ha rilevato e fatto correggere il conflitto del ledger a snapshot ripetibile.
- `node tests/tasks-ui.cjs`: React reale, backend deterministico in memoria e helper coda reali; creazione senza casa, rinvio/conclusione, risposta persa dopo commit simulato + reload/retry, cambio casa, viewer, revoca, layout mobile/desktop.
- `node tests/inventory-ui.cjs`: regressione inventario, proposta OFF, ruoli, cambio casa, scanner e rivalidazione DOM stabile passata. Il mock Supabase esistente è stato estratto in fixture condivisa; il timer di prova ora invoca tutti i controlli registrati senza confondere quelli delle attività con quelli delle case.
- `node tests/optical-browser.cjs`: ZXing reale sui sei campioni EAN13/EAN8/UPC-A/ITF14/vuoto/checksum errato, ciclo frame e cleanup passati in Chromium.
- Typecheck, lint e build passati. Warning Vite preesistente su chunk oltre 500 kB. Build con variabili Supabase vuote, nessuna credenziale incorporata.

Per i test browser avviare Vite sulla porta 5173 con base `/casetta/`; i tre harness richiedono Playwright disponibile nel NODE_PATH e Chromium/Chrome locale (PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH). Nessun account o dato reale usato; nessun accesso remoto/nuovo servizio installato. Non è stato collaudato Safari/iPhone in questo intervento, né eseguito un server Supabase completo locale: DB reale e UI con backend simulato sono prove distinte.

## Revisione finale: arresto e rinvio dei piani

La 005 ora limita l’UPDATE definitivo del piano a complete/cancel. start/confirm non scrivono task_reminder_plans; snooze conserva il piano e usa la data di attenzione esistente. Nessuna nuova colonna, policy o grant. I piani reali R1-A restano disabilitati; nei test un amministratore abilita alcune fixture esclusivamente per verificare che le transizioni non terminali ne preservino i valori. Non vengono inviate notifiche.

`tests/task-transitions.sql` aggiunge 19 verifiche PostgreSQL: piano iniziale, start/snooze/confirm con retry e fixture abilitate/disabilitate, complete/cancel definitivi, timestamp di arresto stabile, retry vecchi che non riaprono né modificano un’occorrenza già conclusa, creazione e rinvio all’ora ambigua autunnale, indipendenza dal fuso della sessione, completamenti molto tardivi. La cadenza di calendario resta ancorata (un solo successore eventualmente arretrato, da verificare, senza ciclo di recupero); l’intervallo dopo completamento parte dall’intervento effettivo. I test concorrenti controllano anche l’arresto del padre e la mancata chiusura del piano del successore confermato. Regressione logica: il rinvio resta un’attività aperta e torna rilevante alla data di attenzione; start/confirm non sono completamenti.

Restano invariati i limiti di R1-A: niente motore invii, nuovo collaudo remoto o nuova prova Safari/iPhone. La modifica alla 005 è preparata per la revisione prima dell’applicazione; se una versione della 005 fosse già stata applicata a un ambiente, non rieseguirla: predisporre una migrazione correttiva successiva autorizzata.
