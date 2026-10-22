# M1-B — Interfaccia Scorte

La pagina Scorte usa lo schema M1-A già applicato secondo lo stato comunicato dall’utente. Non introduce migrazioni, dipendenze, funzionalità Auth o scritture dirette alle tabelle dello stock. `stock_entries` e `stock_movements` vengono solo letti; tutte le variazioni usano `public.record_stock_movement(...)` con una chiave idempotente conservata in `sessionStorage` finché la richiesta non ha un esito positivo.

## Uso

- Elenco per abitazione attiva; la vista si svuota mentre carica i dati di una nuova casa. Ricerca locale immediata e filtri per categoria e disponibilità.
- Lotti distinti per prodotto/formato. Non si aggregano valori con unità, modalità o attendibilità diverse. Il riepilogo mostra posizione, scadenza registrata, confezioni aperte/chiuse e certezza.
- «0 confezioni · Confermato» non viene confuso con «Da verificare», con il livello qualitativo «Finito» o con una stima.
- Ricerca nel catalogo prima della creazione manuale. Un formato già collegato alla stessa casa è disabilitato; il vincolo univoco `(home_id, format_id)` e la gestione del conflitto `23505` impediscono di collegarlo due volte.
- Inserimento minimo di nome, tipo e categoria. Barcode, marca, dimensione del formato, posizione e scadenza sono facoltativi. La disponibilità può restare sconosciuta; sono disponibili conteggio, misura decimale e livello, con certezza confermata o stimata dove prevista dal database.
- Owner ed editor vedono le azioni di modifica; viewer vede solo i dati consentiti dalle query RLS. Il frontend applica la stessa distinzione per orientare la UI, mentre il database resta l’autorità.
- Azioni rapide: `+1`, `−1`, livelli, quantità finita, apertura di confezioni chiuse. Le altre quantità si inseriscono in editor inline. Correzioni inviano `expected_version`; un conflitto ricarica la casa e chiude la correzione aperta, per non salvare una vista obsoleta.
- Cambio posizione crea, se richiesto, una riga `storage_locations` della casa e poi registra il movimento `move`. Rimuovere la posizione usa `p_location_id = NULL`.

Per i movimenti la quantità viene inviata come testo decimale, conservata così anche negli snapshot. Per la lettura PostgREST la selezione richiede `quantity::text`, evitando di convertire il `numeric` in un numero JavaScript. PostgREST documenta il cast delle colonne nella proiezione [Tabelle e viste — PostgREST](https://docs.postgrest.org/en/stable/references/api/tables_views.html#casting-columns).

## Compatibilità con le primitive M1-A

La UI usa le seguenti operazioni:

| Flusso                                                    | Database                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Creare prodotto privato, formato e collegamento alla casa | Insert RLS su `products`, `product_formats`, `home_products`, con grant limitati e trigger di ruolo                     |
| Selezionare un formato già nel catalogo                   | Insert RLS su `home_products`; in caso di collegamento nuovo, prima disponibilità `unknown` via `record_stock_movement` |
| Prima disponibilità e correzioni                          | `correction`; su un lotto esistente viene inviata la versione letta                                                     |
| Incremento, consumo, apertura, livello, posizione         | RPC `record_stock_movement`; nessun DML frontend sullo stock o sul registro                                             |
| Creare una posizione                                      | Insert RLS su `storage_locations`; l’assegnazione al lotto è poi un movimento `move`                                    |

Il browser inoltra l’ID della casa attiva; RPC, policy, trigger e chiavi esterne composite controllano autorizzazioni, ruolo e appartenenza al database. Un cambio casa non riutilizza la lista precedente: le query si rifanno per il nuovo `home_id`.

## Verifiche

### Eseguite in questo incarico

- `pnpm test`: 41 test frontend superati, inclusi quattro test sul modello di disponibilità, precisione decimale, filtri e stati zero/sconosciuto.
- Test Chrome headless a viewport 390×844 con modulo Supabase sostituito da un archivio in memoria: apertura confezioni, doppio tocco rapido, selezione senza duplicati, creazione senza barcode con quantità sconosciuta, correzione misurata stimata, transizioni disponibile/quasi finito/finito, creazione e cambio posizione, cambio casa, vista viewer e assenza di overflow. Nessuna richiesta a Supabase o ad altri servizi.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- I test PostgreSQL M1-A sono descritti in [docs/M1-A.md](M1-A.md). Non sono test di PostgREST/Auth remoto né sostituiscono una verifica browser con Casicali reale.

Per ripetere il test browser, avviare Vite con le due variabili `VITE_SUPABASE_*` impostate a stringa vuota e poi eseguire `node tests/inventory-ui.cjs` con Playwright e Chrome disponibili. Il test rimpiazza il modulo Supabase in pagina; non usa credenziali e non contatta il servizio.

### Non eseguite

Nessuna prova su Casicali reale, nessuna richiesta al Supabase remoto e nessun test su iPhone/Safari o PWA installata. La prova browser è simulata: verifica interazioni e presentazione, non il comportamento HTTP/PostgREST/Auth del progetto reale.

## Limiti e miglioramento schema suggerito

**Aggiornamento M1-B.1:** il limite seguente è risolto nel nuovo codice locale dalla migrazione 003 e dalla nuova RPC. Vedi [M1-B.1](M1-B.1.md), che richiede applicazione dopo revisione prima del frontend. Il paragrafo conserva il contesto della M1-B.

M1-A non offre una RPC che crei atomicamente prodotto privato, formato, collegamento casa e disponibilità iniziale. Oggi questi passaggi sono richieste distinte: un errore dopo la creazione del catalogo può lasciare un prodotto o formato senza scorta iniziale, e ripetere manualmente l’intero inserimento può creare un secondo prodotto simile. Non vengono però inventate quantità o scritti movimenti diretti. Per eliminare questo caso in una milestone successiva è consigliata una RPC dedicata alla creazione del prodotto domestico e del primo stato, con idempotenza della richiesta. Non applicare questo cambiamento senza una migrazione nuova, revisione e test.

Non è implementata la cancellazione di prodotti, formati, posizioni o lotti: lo schema M1-A non concede DELETE diretto. Non si implementano ancora Spesa, acquisti aggregati, scanner, lookup barcode, soglie, aggiornamenti live Realtime o funzionamento offline. Le scorte vengono aggiornate al rientro nella pagina, al cambio casa o con ricarica browser; non c’è una sincronizzazione push in tempo reale.

Tutte le operazioni numeriche sono limitate a sei decimali, conteggi e confezioni restano interi, le misure non attraversano massa/volume quando l’unità del formato è nota. Le modifiche concorrenti a una correzione vengono rifiutate e ricaricate; il consumo/incremento è calcolato dal database sotto lock. Un errore di rete può avere esito incerto: la chiave movimento è mantenuta nella sessione browser per ritentare la stessa richiesta senza raddoppiarla.

## File della M1-B

- Nuovi: `src/inventory/api.ts`, `src/inventory/model.ts`, `src/pages/StockPage.tsx`, `tests/inventory-model.test.ts`, `tests/inventory-ui.cjs`, `docs/M1-B.md`.
- Modificati: `src/main.tsx`, `src/styles.css`, `README.md`.
- Nessuna migrazione, tabella o dato dimostrativo persistente aggiunto.
