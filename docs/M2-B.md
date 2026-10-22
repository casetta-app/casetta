# M2-B — Riconoscimento alimentare Open Food Facts

## Architettura e flusso

`src/recognition` isola orchestrazione/adapter e proposta modificabile. Lo scanner chiama sempre prima findBarcodeFormats con barcode equivalenti UPC-A/EAN-13; uno o più risultati locali escludono OFF. Un errore locale resta errore, non è un miss. Se il catalogo è vuoto viene invocata la Edge Function autenticata `food-facts`. Nessun fetch browser verso OFF, nessuna dipendenza o chiave segreta aggiunta al frontend.

La funzione verifica il bearer JWT tramite Supabase Auth getUser e la membership owner/editor con client soggetto a RLS. Viewer e non autenticati non accedono al proxy. Accetta solo POST con homeId e barcode valido; origine CORS consentita configurabile, URL upstream fisso, nessun URL fornito dall'utente. Solo dopo autorizzazione usa la service_role server-side per le RPC della cache privata. La service_role non viene usata per scrivere prodotti o scorte. I limiti della piattaforma Edge restano necessari contro richieste massive non autenticate, prima della verifica applicativa.

GET `https://world.openfoodfacts.org/api/v3/product/{code}` con User-Agent `Casetta/2-B (https://github.com/casetta-app/casetta)`, product_type=food, lc/cc=it e soli campi code, product_name_it, product_name, brands, quantity, product_quantity, product_quantity_unit. Nome italiano preferito, fallback al nome presente, nessuna estrazione inventata dai testi. Non si inferiscono pesi da formule come 6x500g. Nome/marca/formato mancanti producono proposta incompleta; peso o volume nominale è riportato solo se numerico valido e unità supportata esplicita. Category food è la fonte richiesta, l'utente può cambiarla esplicitamente insieme a tutti i dati della proposta.

La finestra scanner e la fotocamera restano quelle M2-A.3. Il nome/marca suggeriti compaiono anche nell'area superiore; la proposta completa ha conferma breve e comando Modifica dati. Dati incompleti aprono i campi. Quantità nominale e disponibilità domestica sono separate. La conferma chiama createHomeProduct/add_inventory_product con stato unknown: nessun acquisto o incremento automatico. Conferma o salto preparano il prossimo codice. Qualunque assenza/errore mantiene disponibile il normale inserimento manuale.

## Migrazione e concorrenza

Nuovo file `supabase/migrations/202610220004_m2b_food_facts.sql`, da revisionare: nessuna migrazione applicata è stata modificata. Aggiorna la RPC esistente conservando storico, chiavi idempotenti, controllo writer/lock della casa, RLS e search_path vuoto. Accetta source=external/source_ref OFF, anche quando l'utente corregge il barcode: il riferimento resta il record da cui proviene la proposta. Provenienza dichiarativa, non firma di autenticità dei suggerimenti.

Prima di creare metadati cerca il barcode esatto/equivalente fra formati globali e della sola abitazione. Una corrispondenza viene riutilizzata senza sovrascrivere i dati locali; più corrispondenze richiedono scelta del formato (errore 22023). Il lock per casa serializza conferme concorrenti dalla RPC, anche con chiavi diverse; a isolamento ripetibile rimane il retry 40001. Una risposta persa riusa la chiave dell'adapter M1-B.1. Restano i vecchi GRANT di inserimento metadati per compatibilità: client storici che scrivono direttamente possono ancora creare duplicati; la garanzia riguarda il flusso RPC aggiornato. Non si fondono prodotti per somiglianza del nome, né case diverse.

## Cache e limiti

Tre tabelle in private con RLS e nessun accesso anon/authenticated. claim_food_lookup/finish_food_lookup sono SECURITY DEFINER con search_path vuoto, EXECUTE solo service_role. Cache per barcode canonico condivisa fra istanze Edge, dedup tramite lease 15 secondi, controllo globale serializzato in PostgreSQL. Una chiamata in corso restituisce indisponibilità temporanea con retryAfter, senza seconda richiesta upstream. La UI deduplica anche le invocazioni contemporanee equivalenti per abitazione.

TTL: trovato/incompleto 24h, assente 1h, errori 15s, 429 almeno 60s con Retry-After numerico fino a 1h. Budget globale un fetch ogni 7s, quindi meno di 9/minuto su finestre di 60s, inferiore ai 15/min/IP indicati dalla documentazione consultata. Per utente massimo 20 richieste/minuto incluse cache-hit. 503/indisponibilità attivano pausa globale 30s; 429 pausa globale pari alla cache dell'errore. Nessun retry automatico aggressivo. Cache/counters scaduti ripuliti durante l'uso.

Il budget coordina questo progetto, non altre applicazioni Supabase che potrebbero condividere lo stesso IP di uscita. OFF può applicare limiti globali ulteriori e restituire 503. Resta necessario monitorare 429/503 dopo pubblicazione e ridurre il budget o concordare un'uscita dedicata se il traffico condiviso lo richiede. Nessun servizio a pagamento è stato installato.

## Fonte e licenza

Source/source_ref sono persistiti nei prodotti confermati; nelle Scorte compare attribuzione OFF e collegamento ODbL per i prodotti importati. La proposta attribuisce chiaramente la fonte e precisa che i dati sono suggerimenti. Non si importano immagini o informazioni nutrizionali. Il database OFF è ODbL e i singoli contenuti DbCL: conservare fonte/licenza e rispettare gli obblighi ODbL per eventuale futura distribuzione/esportazione di banche dati derivate; questa milestone non pubblica dati domestici né implementa export.

Documentazione consultata:

- https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-api-v3-product-code/
- https://openfoodfacts.github.io/openfoodfacts-server/api/ (identificazione, 15 GET/min/IP, licenze e API usage form)

## Operazioni manuali dopo revisione

1. Revisionare e applicare solo la migrazione 202610220004 al progetto Casetta già esistente, dopo backup/revisione. È transazionale. Non rieseguire migrazioni M0/M1 già applicate.
2. Revisionare `supabase/functions/food-facts/index.ts` e `_shared/off.ts`; il bundler deve includere l'import locale `src/scanner/codes.ts`. Dalla root Casetta preparare/deployare `supabase functions deploy food-facts --project-ref <REF_CASETTA>` soltanto quando autorizzato. Nessun deploy è stato eseguito durante l'incarico.
3. Mantenere verifica JWT del gateway; la funzione verifica comunque l'utente con getUser e non accetta il solo apikey. Verificare compatibilità gateway con le signing keys del progetto in staging. SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY sono segreti backend forniti dall'ambiente Supabase; mai copiarli in VITE_*.
4. Configurare APP_ORIGIN nell'ambiente Edge a `https://casetta-app.github.io` (solo origine, senza /casetta/); per test locale usare l'origine locale invece della produzione. Nessuna nuova variabile frontend. Registrare l'utilizzo tramite l'API usage form OFF e verificare che il contatto GitHub nel User-Agent sia adeguato prima della distribuzione.
5. Verificare in staging JWT assente/scaduto, viewer/editor/owner, CORS, cache-hit/429/503 e conferma, poi pubblicare frontend solo dopo RPC/function operative. Se function/migrazione non sono disponibili, gli altri flussi manuali restano utilizzabili; una proposta esterna non può essere confermata con il vecchio contratto RPC.

## Test e limiti

Fixture sintetiche deterministiche, nessuna richiesta reale a OFF. Test Node per local-first/ambiguità/errore locale, campi italiani/incompleti, codice diverso, 404/429/503, timeout/rete, dedup UPC/EAN e isolamento delle richieste. Handler Edge eseguito trasposto in Node con SDK Auth/database simulati: non autenticato 401, viewer 403 prima della cache, editor/owner cache-hit. Typecheck separato `pnpm exec tsc -p tests/tsconfig.edge.json`; Deno non installato, nessuna esecuzione Edge distribuita è dichiarata.

Test PostgreSQL reali su cluster temporaneo per provenienza, equivalenza UPC/EAN, riuso senza sovrascrittura/movimento, permessi cache, lease, cache negativa e limite globale, oltre alla regressione completa RLS/M0/M1/concorrenza. Browser Chromium con backend OFF simulato: proposta, modifica nome, assenza di scrittura prima della conferma e stock unknown; regressione scanner, permessi, cambio abitazione e DOM stabile. Test ottici reali ZXing invariati. Nessun nuovo collaudo Safari/iPhone o integrazione remota è dichiarato. Resta il warning Vite del bundle principale sopra 500 kB.
