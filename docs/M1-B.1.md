# M1-B.1 — Inserimento atomico dei prodotti

Nuova migrazione: `supabase/migrations/202610220003_m1b1_atomic_product.sql`. Le migrazioni 001 e 002 già applicate sono invariate. Il collaudo reale M1-B e l’applicazione remota M1-A sono lo stato comunicato dall’utente; questo incarico usa soltanto PostgreSQL temporaneo e risposte browser simulate.

## Contratto

`public.add_inventory_product(p_home_id uuid, p_key uuid, p_initial_state jsonb, p_format_id uuid = NULL, p_product jsonb = NULL) → jsonb`.

Fornire esattamente uno tra `p_format_id` e `p_product`. Per un prodotto nuovo, il JSON ammette soltanto `name`, `brand`, `category`, `label`, `kind`, `barcode`, `size_quantity`, `size_unit`. Scope, autore, origine, ID e ruoli non sono parametri modificabili. Lo scope è sempre la casa autorizzata. `p_initial_state` usa il contratto completo M1-A.

La RPC controlla owner/editor prima di leggere esiti precedenti, acquisisce il lock della casa attraverso l’helper M1-A e crea prodotto privato, formato e collegamento domestico. Per un formato esistente verifica esplicitamente che sia comune o privato della stessa casa, anche se il proprietario della funzione può oltrepassare RLS. Un collegamento già presente viene restituito con `created=false`, preservando integralmente tutti i lotti precedenti; in questo caso lo stato iniziale non sostituisce dati esistenti.

Per un nuovo collegamento la funzione invoca **la RPC M1-A `record_stock_movement`**, tipo `correction`, con la medesima chiave UUID. Stato e storico sono quindi validati e scritti dal percorso esistente. Non viene inventato un acquisto. L’esito è `{ home_product_id, created, movement_id }`; `movement_id` è NULL per collegamenti già presenti.

L’intera funzione è una transazione PostgreSQL: qualsiasi errore, compreso un errore dopo la scrittura del movimento, annulla anche tutti i metadati appena creati. Nessun commit interno, chiamata esterna o SQL dinamico.

## Idempotenza e concorrenza

`private.inventory_add_requests` conserva casa/chiave, autore, payload esatto e risultato. RLS abilitata, nessuna policy o privilegio client: l’unico accesso applicativo è dalla RPC. Stessa chiave/autore/payload restituisce lo stesso risultato; un payload o autore differente viene rifiutato. Il controllo di accesso viene rifatto anche per i retry: una revoca impedisce il replay. La cancellazione della casa elimina le richieste; la cancellazione dell’account rende NULL il riferimento autore.

Il lock della casa coordina inserimenti, revoche e cancellazioni M0/M1-A. Le collisioni di unicità concorrenti sono convertite in `40001` dopo il rollback del corpo della funzione. A READ COMMITTED il secondo collegamento può leggere quello appena creato; a REPEATABLE READ e SERIALIZABLE si ritenta da una nuova transazione, con la stessa chiave. Un formato collegato simultaneamente con chiavi differenti produce un solo collegamento e un solo lotto iniziale.

I nuovi prodotti manuali con chiavi distinte restano identità distinte, anche se hanno lo stesso nome: il nome non identifica con certezza marca/variante/formato. Per riusare il catalogo occorre selezionare un formato esistente; non si introduce deduplicazione approssimativa o una nuova unicità globale dei barcode.

La funzione è SECURITY DEFINER con `search_path=''`, nomi qualificati e EXECUTE solo per `authenticated`. Nessun grant aggiuntivo sulle tabelle esistenti. I grant M1-A sui metadati restano per compatibilità: vecchi client possono ancora eseguire inserimenti separati. La garanzia atomica copre il flusso della nuova RPC; frontend e migrazione vanno aggiornati insieme.

## Frontend

`createHomeProduct` e `attachCatalogFormat` effettuano una sola RPC `add_inventory_product`. Le altre operazioni restano su `record_stock_movement`; la creazione delle posizioni non cambia. Il helper `addition.ts` conserva la chiave pendente in sessionStorage, distinta per account, casa e richiesta. Una risposta persa o non valida non cancella la chiave. Il fallback in memoria copre storage indisponibile nella scheda corrente; in quel caso la continuità del retry dopo chiusura/refresh non è garantita.

Il normale ritorno riuscito elimina la chiave pendente: un nuovo inserimento manuale successivo è una nuova operazione. Non cambiare payload o chiave per ritentare una richiesta dall’esito incerto.

## Test eseguiti

- PostgreSQL 17.11 temporaneo: 200 asserzioni SQL, di cui 23 nuove per inserimento completo, idempotenza, payload/autore differenti, viewer/anon, isolamento formato privato, revoca, rollback e grant. Errore forzato nel registro richieste dopo il movimento: nessun residuo in prodotti, formati, collegamenti, scorte o storico.
- 9 nuovi scenari concorrenti: stessa chiave su sei connessioni, chiavi distinte su formato già collegato e primo collegamento concorrente a formato comune; ogni scenario a READ COMMITTED, REPEATABLE READ e SERIALIZABLE. Rimangono verdi i 48 scenari concorrenti M0/M1-A.
- Confronto esatto delle sei tabelle inventario prima/dopo l’applicazione della nuova migrazione su dati M1-A preesistenti; confronto M0 e assenza di seed.
- `pnpm test`: 45 test frontend, inclusi retry con risposta persa, chiavi separate, singola chiamata RPC e verifica dell’esito.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: superati. Build con avviso non bloccante per chunk di circa 553 kB / 159 kB gzip.
- Browser Chrome con Supabase simulato: inserimento tramite nuova RPC e regressioni M1-B (apertura, quantità, livelli, posizione, doppio tocco, cambio casa, viewer). Nessun traffico verso Supabase.

Queste sono prove PostgreSQL reali locali e test frontend simulati, non una prova della nuova RPC sul PostgREST remoto. Nessun test iPhone/Safari reale eseguito in questo incarico.

## Applicazione dopo revisione

La migrazione 003 è **preparata e non applicata al remoto**. Dopo revisione e backup, applicare solo il nuovo file completo al progetto Casetta con il processo di migrazione già scelto; non rieseguire 001/002 né i file tests sul database reale. Applicarla prima di pubblicare il frontend aggiornato: senza la funzione nuova, l’aggiunta restituisce un errore esplicito da Supabase. Non c’è fallback all’inserimento separato.

Nessuna modifica a Casicali, nessun commit, push o deploy. Fine M1-B.1.
