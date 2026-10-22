# M2-B.1 — Correzioni pre-deploy

Checkout principale: `/Users/gianluigitarantino/Documents/Codex/casetta`, branch `main`.

## Correzioni

- `food-facts/index.ts`: il Bearer deve contenere un JWT a tre segmenti. Il token estratto viene passato esplicitamente a `auth.getUser(jwt)`. Il client con chiave anon e Authorization dell'utente verifica la membership attiva sotto RLS usando esclusivamente l'ID restituito da Auth. Viewer e membership assenti/revocate ricevono 403. Solo dopo questa verifica il client service_role accede alle RPC della cache privata, mai alle tabelle domestiche.
- `_shared/request.ts`: JSON letto a blocchi con limite effettivo di 1 KiB, anche senza Content-Length; limite dichiarato eccessivo rifiutato prima della lettura. JSON/UTF-8 malformati, UUID non valido e barcode non valido restituiscono 400 prima di Auth/query. Header assente/malformato o token rifiutato da Auth restituiscono 401. Un errore del database resta 503. CORS resta limitato all'origine configurata, senza wildcard.
- `_shared/off.ts` e `src/recognition/api.ts`: validazione runtime dei payload prima dell'uso nella UI e delle risposte presenti nella cache. Per found/incomplete tutti i campi della proposta devono essere stringhe coerenti; controllati anche quantità/unità, barcode equivalente e URL OFF della fonte. Payload malformati diventano unavailable, mai absent. OFF con strutture o tipi inattesi è indisponibile; campi legittimamente mancanti producono una proposta incompleta.
- `supabase/config.toml`: `verify_jwt = true` esplicito per food-facts. Non usare `--no-verify-jwt` alla futura distribuzione.

Nessuna modifica M2-B.1 a scanner, fotocamera, preview, checksum, rivalidazione delle abitazioni, migrazioni o contratto RPC. Restano local-first, equivalenze UPC-A/EAN-13 con zeri iniziali, fallback manuale, provenienza, cache e limiti esistenti.

## Verifiche eseguite

- `pnpm test`: 65 test superati. L'handler Edge effettivo viene trasposto in Node; SDK Auth/database simulati verificano esattamente il JWT passato a getUser e l'Authorization del client RLS. Casi bearer assente/malformato, scadenza simulata, viewer/editor/owner, membership assente, errore database, CORS, JSON malformato, body dichiarato e streaming eccessivo, UUID/checksum non validi e ID nel body ignorato. I test verificano inoltre risposte valide/incomplete/malformate, local-first, HTTP 401/403/404/429/503, rete/timeout e deduplicazione UPC/EAN.
- `pnpm test:db`: PostgreSQL 17.11 locale temporaneo, 209 controlli SQL e 57 scenari concorrenti superati. Inclusi RLS, compatibilità del contratto RPC M2-B, provenienza, cache e inserimento idempotente.
- `node tests/inventory-ui.cjs`: regressione Chromium superata su layout mobile/desktop, scorte, proposta OFF modificabile, nessuna scrittura prima della conferma, viewer, cambio abitazione e rivalidazione senza remount.
- `node tests/optical-browser.cjs`: ZXing reale in Chromium sui sei campioni EAN-13, EAN-8, UPC-A, ITF-14, immagine vuota e checksum errato; ciclo video canvas e cleanup superati.
- `pnpm typecheck`, `pnpm exec tsc -p tests/tsconfig.edge.json`, `pnpm lint`, `pnpm build`: superati. Build eseguita con variabili Supabase vuote, senza incorporare credenziali reali.

## Limiti e attivazione

La scadenza del JWT è simulata tramite risposta Auth: non è una verifica crittografica live. Deno e gateway Supabase non sono stati eseguiti; restano da verificare in un ambiente autorizzato la compatibilità del gateway con le signing key del progetto, token reali scaduti/validi e l'integrazione della funzione distribuita. Nessuna richiesta reale a OFF, modifica di dati reali, migrazione remota, distribuzione, commit o push. Nessun nuovo collaudo Safari/iPhone dichiarato. Rimane il warning Vite sul chunk principale oltre 500 kB.

Per l'attivazione futura seguire le operazioni manuali M2-B dopo revisione, includendo il nuovo helper request.ts e mantenendo attiva la verifica JWT. Nessuna nuova migrazione o variabile frontend è richiesta da M2-B.1.
