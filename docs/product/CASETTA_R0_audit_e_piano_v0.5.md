# CASETTA — Audit R0 e piano di riallineamento alla specifica v0.5

**Data:** 23 ottobre 2026
**Riferimento:** `CASETTA_specifica_v0.5.md`
**Repository esaminato:** `https://github.com/casetta-app/casetta`, `main` a `c7a4381440990a6417ee91e3570ed397de546d62`
**Metodo:** lettura del repository GitHub e delle migrazioni; **non** esecuzione di test, query al database di produzione, prova OCR o push reali. Le verifiche iPhone già effettuate nelle conversazioni precedenti sono separate dal presente audit.

## 1. Diagnosi sintetica

Il codice esistente implementa un **motore di inventario** solido rispetto al perimetro originario M0–M2-B, non ancora l'assistente domestico previsto nella v0.5. Il riutilizzo è possibile e preferibile. La priorità non è rifinire lo scanner o completare il vecchio carrello: è creare il dominio trasversale **responsabilità → eventi → scadenze → evidenze → memoria** e verificare subito le due dipendenze ad alto rischio (**notifiche autonome su iPhone** e **lettura reale degli scontrini italiani**).

## 2. Matrice di inventario del codice

| Area | Stato osservato | Decisione v0.5 | Evidenza nel repository |
|---|---|---|---|
| React 19 / Vite / TypeScript / GitHub Pages | Esiste e viene distribuito con CI | **Conservare** | `package.json`, `.github/workflows/deploy.yml`, `src/main.tsx` |
| Supabase Auth / PKCE / ripristino sessione | Implementato | **Conservare** e fare regressioni iPhone | `src/auth/*`, `src/lib/supabase.ts` |
| Case, cambio casa e ruoli RLS | Implementati; inviti non ancora operativi | **Conservare ed estendere** | `src/homes/*`, migrazione `202610220001` |
| Multiutenza effettiva via invito | Non implementata nell'interfaccia/nel dominio di inviti | **Nuovo intervento** | `src/pages/ManagementPage.tsx`, `README.md` |
| Catalogo prodotti e scorte ibride | Implementati con RPC atomiche | **Conservare come sottosistema opzionale**, non al centro della UX | `src/inventory/*`, `src/pages/StockPage.tsx`, migrazioni `002–004` |
| Barcode e Open Food Facts | Implementati e precedentemente collaudati su iPhone; OFF alimentare | **Conservare come strumento contestuale** | `src/scanner/*`, `src/recognition/*`, Edge Function `food-facts` |
| Home `Oggi` | Solo stato vuoto e CTA "Apri le scorte" | **Ripensare integralmente** attorno a scadenze/pratiche/attenzione | `src/pages/TodayPage.tsx` |
| `Spesa` | Pagina "in preparazione" | **Nuovo dominio**: lista agile, scontrini, spese, prezzi | `src/main.tsx`, `src/pages/ComingSoonPage.tsx` |
| Agenda / attività / ricorrenze | Nessuna entità o pagina dedicata osservata | **Nuovo dominio prioritario** | `src/main.tsx`, elenco migrazioni `001–004` |
| Notifiche iPhone in background | Non implementate; service worker solo install/activate | **Spike bloccante** e implementazione verificata | `public/sw.js` |
| Calendario iPhone | Non implementato | **Nuovo adattatore** ICS protetto/revocabile, testato | `src/main.tsx`, nessuna rotta/feed esistente |
| Originali PDF/foto / Storage documenti | Nessun dominio documentale presente | **Nuovo dominio** privato e con autorizzazioni personali/casa | migrazioni `001–004`, `src/lib/*` |
| OCR scontrini / parsing / sconti | Non implementato | **Spike bloccante** con corpus italiano reale + revisione | `package.json` non contiene OCR |
| Economia domestica e andamento prezzi | Non implementati | **Nuovo dominio centrale** | nessuna entità `purchases`, `expense_entries`, `price_observations` nelle migrazioni |
| Memoria collegata / tracciabilità delle fonti | Solo provenienza limitata per catalogo e storico stock | **Nuovo dominio** evidenze/fatti/relazioni/confidenza | `products.source_ref`, `stock_movements` non sufficienti |
| Onboarding conversazionale/adattivo | Solo creazione abitazione/account | **Nuovo flusso**; salvataggio progressivo e prima delega reale | `src/homes/CreateHomeForm.tsx`, `src/pages/TodayPage.tsx` |
| Preferenze, abitudini, suggerimenti | Non implementati | **Nuovo dominio** statistico, feedback e regole di attenzione | nessuna entità dedicata |
| Offerte supermercati | Non implementate | **R5, non eliminare dalla V1**; pilota verificato per punto vendita | nessun adapter o feed presente |
| Export, backup ripristinabile e cancellazione documenti | Script/test per DB presenti; export documentale assente | **Nuovo requisito trasversale** e prova di ripristino | `tests/run-database.py`; assenza di export applicativo |

## 3. Debiti e rischi tecnici specifici

1. **Confine personale/casa assente nei nuovi domini.** `home_members` governa le case, ma non basta per proteggere una polizza personale collegata a una casa condivisa. Definire `owner_user_id`, `home_id` (se applicabile), `visibility`, grant/RLS e relative revoche prima di importare documenti.
2. **Non confondere prodotto, bene, evento e spesa.** `products` + `home_products` e `stock_movements` sono idonei alle scorte, non a documenti assicurativi, veicoli, attività, spese e contratti. Evitare di ampliare `products` fino a renderlo entità universale.
3. **No idempotenza globale oggi.** Esiste idempotenza per RPC di inventario; serviranno chiavi separate per acquisizione, riconciliazione scontrino, transazioni economiche, creazione ricorrenze e invio notifiche.
4. **Service worker minimo.** `public/sw.js` non gestisce `push` o `notificationclick`. Web Push necessita permesso utente, subscription, gestione scadenze subscription, schedulazione remota, protezione dalle duplicazioni e verifica reale con PWA chiusa.
5. **Supabase Free e affidabilità.** Non equiparare un cron in browser o il solo DB a promemoria affidabili. Il piano notifiche deve avere un fallback collaudato e dichiarare eventuale degrado.
6. **OCR reale, non solo testo letto.** Preprocessing, layout multi-foto, righe, sconti, resi, totali, associazioni e revisione dell'utente sono problemi distinti. Benchmark su scontrini italiani anonimizzati e metriche per singolo campo; nessun dato privato nei test pubblici.
7. **UI stock troppo accentrata.** `StockPage.tsx` conta oltre 2.300 righe e contiene scanner, form e molte azioni di gestione puntuale: mantenerne la funzionalità, ma estrarre componenti e relegare l'inventario esatto a una modalità contestuale, senza refactor distruttivo iniziale.
8. **Specifiche/repository disallineati.** Il `README.md` si presenta ancora come M1-B.1 e alcune indicazioni dichiarano scanner/spesa "in preparazione" nonostante la M2-B pubblicata. Aggiornare documentazione di stato prima di nuove consegne.
9. **CI incompleta per nuove esigenze.** La pipeline valida frontend ma non esegue `test:db`; integrare test di RLS/migrazioni nel percorso appropriato, senza supporre che GitHub Actions abbia Postgres configurato.
10. **Backup esistente ma ripristino non provato.** Un backup prima di M2-B è stato creato separatamente in precedenza; non è garanzia del contenuto attuale e non include necessariamente tutti gli asset/Auth. Verificare backup aggiornato e restoration drill prima di applicare nuove migrazioni.

## 4. Contratto architetturale da fissare in R0

### A. Soggetti e responsabilità

- `actor`: account che effettua un'azione; `scope`: personale o abitazione; `visibility`: regola esplicita applicata dal DB.
- `subject`: entità a cui un fatto si riferisce (veicolo, impianto, animale, utenza, bene, servizio), distinta da `product_format`.
- `task`: pratica o impegno con stato, provenienza, ricorrenza e piano di attenzione; **`overdue` derivato**, non stato che cancella `snoozed/completed`.
- `evidence`: originale o fatto dichiarato, con versioni, accesso e contesto della conferma.
- `event`: evento confermato e temporalmente identificato (acquisto, pagamento, intervento, rinnovo, completamento).

### B. Pipeline acquisizione

`foto / PDF / voce / testo → bozza → estrazione → collegamenti ipotizzati → riepilogo revisionabile → conferma unica → scrittura atomica → storico / calendario / suggerimenti`.

L'estrazione non implica mai una mutazione confermata. Errori di rete e doppio upload non possono creare eventi/spese duplicati. Una fonte sconosciuta rimane sconosciuta, non inventata.

### C. Memoria e apprendimento

Memoria distinta in dichiarata, storica, appresa e temporanea; campi di fonte/confidenza e controllo utente. Gli acquisti confermati insegnano una frequenza, **non** il consumo certo di una confezione. Suggerimenti in `Oggi` e push solo per obblighi importanti confermati.

## 5. Sequenza di implementazione consigliata

### R0-A — Protezione della base e specifiche operative (nessun deploy)

- Collocare v0.5 nel progetto come documento di riferimento **solo dopo aver verificato che non contenga dati che non si vogliono nel repository pubblico**; mantenere v0.3 storica.
- Conservare le migrazioni `001–004` senza editarle e mettere per iscritto stato reale, esiti test e dati da preservare.
- Definire schema ERD concettuale e permessi di `task`, `subject`, `evidence`, `capture`, `expense`, `habit`, compreso `user/home/visibility`, senza creare tabelle in blocco.
- Scrivere contratto/API e state machine R1 e un protocollo di deploy/rollback per ogni futura migrazione.

**Uscita:** design R1 reviewable, tracciato del backup, nessuna alterazione di dati o interfaccia.

### R0-B — Due esperimenti tecnici in parallelo al design

**Push iPhone:** service worker, subscription, scheduler gratuito indipendente, esiti registrati e notifica con app chiusa. Dimostrare accensione/chiusura/revoca e mancate duplicazioni; non basta simulare una notifica nella UI.

**OCR scontrino:** applicazione o harness isolato, 10–20 scontrini italiani diversi **anonimizzati e forniti volontariamente**; misurare data/negozio/totale, quantità, unità, sconti, denominazioni delle righe. Controllare performance reale Safari/iPhone e il numero di correzioni necessarie. Nessun acquisto contabilizzato.

**Uscita:** rapporti di fattibilità con metriche, costi e lacune, non affermazioni generiche.

### R1 — Prima delega completa (non una demo)

1. Migrazione additiva per attività/scadenze, state machine, policy personale/casa testate e API idempotenti.
2. `Oggi` mostra scadenze reali e pratiche aperte; `Agenda` gestisce creazione rapida, rinvio, conclusione e ricorrenza verificata.
3. Onboarding adattivo collegato a preferenze reali e prima incombenza; voce in modalità verificata su iPhone, fallback testuale.
4. Motore notifiche/canale calendario con limiti verificati; niente indicatore "push attivo" senza prova.
5. Collaudo end-to-end: registrazione di un promemoria, notifica con app chiusa, sollecito dopo mancato completamento, stop dopo «Fatto», corretta separazione personale/casa.

### R2–R5 — Verticali da portare realmente a termine

- **R2:** archivio privato, OCR documentale, revisione, correlazioni con bene/veicolo/utenza, export.
- **R3:** scontrino italiano → revisione → transazione economica e prezzi → lista; 25 righe, sconti e duplicati.
- **R4:** abitudini e suggerimenti in-app correggibili, senza stock obbligatorio.
- **R5:** pilota offerte reali/locali, matching attendibile, rifinitura e gate V1.

## 6. Regole di modifica

- Non cancellare scorte, storico o catalogo esistenti; non modificare migrazioni già applicate.
- Ogni nuova migrazione solo additiva, RLS/grant/revoche testati per proprietario, editor, viewer, estraneo e anonimo; isolamento fra abitazioni.
- Test di idempotenza e concorrenza per registrazioni e notifiche; rollback dell'app e piano dati documentati.
- Nessun refactor cosmetico massivo prima dei due spike ad alto rischio.
- Ogni interfaccia dichiarata funzionante dev'essere collaudabile; niente funzioni simulate presentate come operative.
- Non usare file reali sensibili in un repository pubblico; fixture anonimizzate o sintetiche e documentate.
- Nessun deploy o SQL remoto senza backup e controllo esplicito del diff.

## 7. Stato dopo questo audit

**Verificato:** struttura repository `main`, rotte, pagine, schema/migrazioni versionate, esistenza e assenza dei domini elencati.
**Non verificato in questa analisi:** working tree Mac dell'utente, consistenza del DB remoto, backup odierno, possibilità reale di push gratuito 24/7, accuratezza OCR su scontrini effettivi, storage/limitazioni effettive per dati sensibili, comportamento Safari dopo le ultime patch.
**Repository remoto modificato:** **no**.
