# CASETTA — Specifica funzionale e tecnica v0.3

**Data:** 21 ottobre 2026  
**Stato:** progettazione; nessuna implementazione avviata da questa specifica.  
**Novità v0.3:** percorso di primo avvio, assenza di inventario iniziale, accesso per invitati, recupero sessione e criteri UX M0. Include integralmente le decisioni della v0.2.

## 1. Visione e principi

Casetta è una PWA per la gestione domestica che aiuta le persone a sapere cosa hanno, cosa devono acquistare e cosa richiede attenzione. Non chiede all'utente di mantenere un inventario perfetto: acquisisce eventi a basso attrito, usa stime distinguibili dai dati confermati e richiede controlli solo per eccezione.

Principi vincolanti:
1. **Un'azione, più aggiornamenti**: registrare un acquisto aggiorna scorte, lista della spesa e storico in un'unica operazione coerente.
2. **Verità e stime separate**: quantità confermate, livelli indicativi e previsioni non sono intercambiabili.
3. **Casetta e persona sono entità diverse**: account personali, abitazioni indipendenti, accesso condivisibile solo tramite autorizzazione esplicita.
4. **Privacy predefinita**: nessun accesso incrociato implicito fra familiari, amici o abitazioni.
5. **Poche interazioni**: barcode continuo, prodotti abituali, quantità rapide, conferma unica del carrello.
6. **Una casa resta operativa anche se l'app non viene aperta**; le stime devono però perdere attendibilità in assenza di dati, senza fingere aggiornamenti impossibili.
7. **Architettura estensibile senza sovradimensionamento della V1**.

## 2. Ambito della versione 1.0

### Incluso
- Registrazione e accesso con Supabase Auth; profilo personale.
- Creazione di una o più abitazioni, cambio dell'abitazione attiva.
- Invito a un'altra persona via email/link a una casa, con ruolo `owner`, `editor` o `viewer`; il legame è direzionale e revocabile.
- Catalogo prodotti con barcode opzionale, nome, marca, formato/confezione, unità di misura e categoria.
- Ricerca nel catalogo locale, aggiunta manuale, riconoscimento via API di prodotti alimentari, salvataggio dei prodotti già riconosciuti per scansioni successive.
- Gestione delle scorte in modo ibrido: **esatto** (es. 3 confezioni), **indicativo** (presente/quasi finito/esaurito), **misurabile** (g, kg, ml, l); quantità e livello di certezza espliciti.
- Posizioni domestiche (dispensa, frigorifero, bagno, ecc.) modificabili.
- Scansione continua, con incremento di quantità nel carrello per scansioni ripetute dello stesso codice, feedback immediato e prevenzione delle doppie letture accidentali.
- Sessione di acquisto temporanea: scansione, aggiunta manuale e prodotti abituali confluiscono nello stesso carrello; conferma unica e transazionale.
- Lista della spesa manuale e suggerimenti automatici basati sulle soglie minime; righe distinguibili per origine e quantità consigliata.
- Registrazione rapida di consumi (terminato, sottrai 1, modifica disponibilità), correzione manuale dello stock.
- Storico essenziale dei movimenti, con autore, data, motivo e riferimento alla sessione di acquisto.
- Home «Oggi» con poche azioni rilevanti: scorte basse, scadenze *solo se registrate*, controlli da verificare.
- Aggiornamenti visibili ai membri autorizzati della stessa casa.

### Escluso dalla V1
- Riconoscimento dello scontrino, comandi vocali, ricette integrate, previsioni sofisticate e suggerimenti basati su IA.
- Domotica, sensori, finanziario domestico, animali, manutenzioni, documenti, gestore delle faccende.
- Permessi granulari per singola sezione, condivisioni pubbliche o social network di contatti.
- Gestione completa offline con sincronizzazione bidirezionale; da progettare dopo la verifica dei flussi online.

Queste funzioni sono previste come espansioni, non promesse della prima release.

## 3. Architettura dell'esperienza

Navigazione mobile principale (4 aree):
1. **Oggi** — «Cosa richiede attenzione?»
2. **Scorte** — inventario, filtri per categoria/posizione, ricerca.
3. **Spesa** — lista e registrazione acquisti.
4. **Gestione** — case, membri, ruoli, categorie, impostazioni.

Azione primaria persistente: **Scansiona**; all'apertura permette di scegliere l'intento o mantiene quello del contesto: *acquisto*, *consulta*, *consumo*.

La home non deve trasformarsi in un elenco di tutte le statistiche: mostra al massimo pochi elementi prioritari, con accesso al resto su richiesta.

## 4. Flussi essenziali

### A. Primo accesso
1. Autenticazione con account personale (preferenza UX: accesso via email con codice monouso o link; validare la soluzione effettiva in M0).
2. Se l'account non ha abitazioni, offrire **Crea una casa** oppure **Accetta un invito** (la seconda opzione deve essere operativa solo quando la relativa milestone è implementata; nessun falso pulsante).
3. Per la creazione chiedere soltanto **nome della casa** (es. "Casetta mia"); nessun indirizzo fisico obbligatorio, nessuna registrazione scorte, nessuna soglia o categoria da configurare.
4. La creazione attribuisce automaticamente il ruolo `owner` al creatore; l'accettazione di un invito attribuisce esclusivamente il ruolo consentito.
5. Entrata immediata nella home vuota con CTA contestuali. La guida è progressiva e non obbligatoria.
6. L'account invitato non è obbligato a creare un'abitazione propria.
7. Nessuna condivisione automatica con contatti o familiari. Vedi §17-22 per UX completa e criteri di accettazione.

### B. Acquisto di più prodotti
1. **Spesa → Registra acquisti**.
2. Lettore barcode continuo, con pausa/ripresa; fallback per inserimento codice manuale e ricerca per nome.
3. Lookup prima nel catalogo locale; se non trovato, interrogazione controllata del database esterno.
4. La prima scansione inserisce il prodotto nel carrello con quantità 1; successive scansioni intenzionali lo incrementano. Un debounce breve evita letture ripetute del medesimo inquadramento, senza impedire l'incremento deliberato.
5. Per i prodotti non trovati, creazione minima di nome e confezione, sempre possibile.
6. È possibile aggiungere prodotti abituali e alimenti sfusi senza barcode.
7. Il carrello permette modifiche immediate delle quantità e, quando necessario, della posizione destinazione.
8. **Conferma una sola volta**. Una transazione salva sessione, righe, movimenti e nuove disponibilità; riconcilia la lista della spesa senza cancellare esigenze non soddisfatte.
9. In caso di richiesta duplicata o connessione instabile, una chiave di idempotenza impedisce la doppia contabilizzazione.

### C. Consumo
- Dalla scheda prodotto: «-1», «Finito», «Quasi finito», «Imposta quantità».
- I prodotti a livello indicativo non richiedono una misura esatta.
- Le correzioni manuali non vengono falsamente registrate come acquisti o consumi; hanno il tipo `correction`.

### D. Lista automatica
- Ogni prodotto può avere soglia minima e quantità-obiettivo, entrambe opzionali.
- Quando la quantità **confermata** raggiunge o scende sotto la soglia, Casetta propone la quantità necessaria a raggiungere il target.
- Quando è disponibile soltanto una stima, Casetta crea un suggerimento esplicitamente indicato come «da verificare», non un ordine certo.
- Le voci aggiunte manualmente possono esistere anche senza un prodotto a catalogo.
- Un acquisto parziale lascia in lista la quantità residua. Acquisti e voci non si eliminano automaticamente in modo cieco.

### E. Case, conviventi e accessi esterni
- Ogni account può possedere o usare più case.
- `owner`: gestisce dati, inviti e ruoli; deve rimanere almeno un proprietario.
- `editor`: aggiorna scorte, spese e acquisti.
- `viewer`: consulta soltanto dati autorizzati.
- L'accesso a una casa di altri può essere definito `guest` e resta **unidirezionale**. La condivisione reciproca è costituita da due autorizzazioni distinte.
- Abitazioni non collegate non possono consultarsi reciprocamente.
- Eventi e cronologia indicano chi ha modificato cosa, nei limiti dei permessi.
- Inviti con scadenza, revoca, accettazione esplicita, e controlli di sicurezza sul server/database.

### F. Controllo rapido (prima versione minima)
- Suggerire verifica manuale solo su prodotti con disponibilità incerta o scaduta.
- Nessuna notifica ossessiva, né obbligo giornaliero.
- Esiti: «Confermato», «Quasi finito», «Finito», «Non ora».

## 5. Modello dati logico iniziale

Le tabelle sotto sono una proposta, da tradurre in migrazioni SQL con vincoli e RLS testate.

| Entità | Scopo / campi principali |
|---|---|
| `profiles` | `user_id`, nome visualizzato, preferenze essenziali |
| `homes` | `id`, nome, creatore, fuso orario |
| `home_access` | `home_id`, `user_id`, `role` (owner/editor/viewer), `relationship` (resident/guest), data accesso/revoca |
| `home_invitations` | `home_id`, email destinatario o token hash, ruolo, scadenza, stato |
| `storage_locations` | `id`, `home_id`, nome, ordinamento |
| `products` | `id`, `barcode` (nullable), nome, marca, formato, unità, fonte e dati esterni; catalogo condiviso/riutilizzabile |
| `home_products` | `home_id`, `product_id`, alias locale, modalità preferita, soglia, target, categoria/posizione predefinita |
| `stock_entries` | `home_id`, `product_id`, `location_id`, stato confezione se utile, quantità e unità **oppure** livello indicativo, attendibilità, data ultima conferma, scadenza opzionale |
| `stock_movements` | `home_id`, prodotto, tipo (`purchase`, `consume`, `correction`), quantità prima/dopo o delta, autore, timestamp, riferimento sessione |
| `purchase_sessions` | `id`, `home_id`, autore, stato bozza/confermato, chiave idempotenza, timestamp |
| `purchase_lines` | `session_id`, prodotto, quantità, unità, destinazione, prezzo opzionale |
| `shopping_items` | `home_id`, prodotto o testo libero, quantità richiesta/acquistata, origine (`manual`/`threshold`/`estimate`), stato |
| `home_events` | `home_id`, evento, soggetto, autore, timestamp, visibilità futura |

Vincoli:
- Tutti i dati domestici devono riferirsi a una `home_id` precisa.
- **Mai** concedere accesso basandosi sul solo fatto di essere contatti o familiari.
- Un codice a barre identifica un prodotto/confezione nel catalogo, **non** una quantità posseduta.
- Valori monetari in minor unit (centesimi), se presenti; prezzi facoltativi.
- Nessuna cancellazione silenziosa dello storico quando si corregge una scorta.
- Identità e autorizzazione verificate per ogni operazione, incluse RPC e funzioni di backend.
- Disponibilità e movimenti aggiornati atomicamente, perché due conviventi possono operare contemporaneamente.

## 6. Sicurezza e isolamento

- Progetto GitHub e progetto Supabase **nuovi e completamente separati** da LuLab Desk.
- Autenticazione con Supabase Auth.
- Abilitare RLS su ogni tabella esposta e definire i grant minimi. Le policy devono verificare ruolo e appartenenza alla casa; `service_role` mai nel client.
- Test automatici di accesso almeno per: proprietario, convivente editor, osservatore, utente di un'altra abitazione, utente non autenticato, invito revocato.
- Verificare anche i tentativi di cambiare `home_id` e i permessi nelle operazioni aggregate.
- Eventuali funzioni con privilegi elevati devono essere ristrette e testate, non usate per eludere genericamente RLS.
- Revoca accesso e cancellazione dati secondo flussi espliciti; backup e migrazioni riproducibili.

## 7. Tecnologia e integrazioni

- Frontend PWA responsive mobile-first, preferibilmente stack TypeScript e componenti riusabili; scegliere il framework definitivo all'inizio della fase tecnica.
- Supabase Postgres, Auth, Storage solo per eventuali immagini, Realtime dove necessario.
- Scanner: `@zxing/browser` come candidato principale per scansione continua da camera; test sul modello di iPhone in uso prima di confermarlo. Non affidarsi esclusivamente al `BarcodeDetector` nativo perché il supporto browser è disomogeneo.
- Prodotti alimentari: Open Food Facts; per nuove integrazioni valutare **API v3 corrente**, anziché progettare direttamente sulla v2 deprecata. Usare un adapter interno, cache locale, identificazione dell'app nelle richieste e rispetto dei limiti/licenze. I dati esterni vanno trattati come suggerimenti correggibili.
- Oggetti non alimentari: creazione manuale/locale nella V1; ulteriori cataloghi soltanto in seguito.
- Gestire assenza di camera, permessi negati, barcode illeggibili, mancata rete e prodotti sconosciuti con fallback testuali.

Riferimenti da consultare prima dell'implementazione:
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://github.com/zxing-js/browser
- https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
- https://openfoodfacts.github.io/openfoodfacts-server/api/
- https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-api-v3-product-code/

## 8. Piano di implementazione in milestone

**M0 — Progetto e sicurezza:** nuovo repository, applicazione vuota, progetto Supabase separato, migrazioni, login, home e home_access, RLS e test di isolamento.

**M1 — Catalogo e scorte:** creazione e ricerca prodotti, posizioni, quantità esatte/indicative/misurabili, movimenti e correzioni, schermata Scorte.

**M2 — Scanner e carrello:** camera iPhone, lookup prodotti, fallback manuale, scansione continua, deduplicazione, sessione di acquisto e commit atomico.

**M3 — Spesa intelligente:** lista manuale, soglie/target, suggerimenti, acquisti parziali, home Oggi, contatori essenziali.

**M4 — Condivisione e rifinitura:** inviti, editor/viewer, cambio casa, aggiornamento multiutente, Controllo rapido, accessibilità, test reali.

## 9. Criteri di accettazione per considerare la V1 utilizzabile

1. Due account hanno due abitazioni: nessuno può leggere o modificare i dati dell'altro senza invito.
2. Un account può essere invitato come osservatore della casa altrui, senza condividere la propria.
3. Due conviventi editor possono aggiornare la stessa scorta senza perdere movimenti concorrenti.
4. Scansione multipla di tre confezioni dello stesso prodotto produce una sola riga nel carrello, quantità 3.
5. Confermare il carrello una volta aggiorna correttamente scorte, storico e lista; un retry della stessa operazione non raddoppia le quantità.
6. Un barcode sconosciuto non blocca la registrazione dell'acquisto.
7. Un prodotto con disponibilità stimata è sempre riconoscibile come stimato; non viene mostrato come quantità certa.
8. Soglie e obiettivi producono suggerimenti intelligibili, senza duplicazioni incontrollate.
9. Un acquisto parziale non marca erroneamente come completa tutta la lista.
10. Sul dispositivo reale, il flusso normale di spesa richiede il minor numero di tocchi possibile.

## 10. Decisioni già confermate e questioni ancora aperte

**Confermato:** uso personale ma struttura multiutente, case autonome, condivisioni unidirezionali/revocabili, scorte ibride, scansione continua, carrello con conferma unica, Controllo rapido, minimo lavoro manuale, progetti isolati da LuLab.

**Da dettagliare durante la progettazione UI:** priorità visive, flusso iOS della camera, modello dei prodotti abituali, soglie automatiche, semantica delle confezioni aperte, frequenza dei controlli, eventuali notifiche nella V1, nomenclatura e identità visiva.


---

# Addendum v0.2 — UX operativa di Scorte e Spesa

## 11. Il flusso principale: comprare senza compilare quindici schede

### Percorso consigliato

1. Dalla scheda **Spesa** seleziona **Registra acquisti**. Se stavi consultando la lista, apri lo stesso carrello, non un flusso diverso.
2. Sullo schermo compare subito la fotocamera, con indicazione **casa attiva** ben visibile (es. «Casetta mia»), contatore articoli e accesso al carrello; non richiedere di selezionare modalità o posizione a ogni acquisto.
3. Inquadra il codice a barre. Se il prodotto è conosciuto, il feedback visivo e tattile conferma «aggiunto». Se lo stesso prodotto viene letto in modo intenzionale un'altra volta, si incrementa la quantità nell'unica riga del carrello.
4. L'interfaccia offre subito `+` e `−` sulla riga, perché, per cinque confezioni identiche, è spesso più efficiente una sola scansione e quattro tocchi sul `+` rispetto a cinque scansioni.
5. Per prodotti senza barcode, entra nella ricerca: i prodotti abituali appaiono per primi. L'inserimento manuale è rapido e accetta quantità facoltative o livelli indicativi.
6. Tocca **Carrello**; qui si possono correggere quantità e unità, rimuovere righe e scegliere la posizione solo se diversa da quella già memorizzata.
7. Tocca **Conferma acquisti** una sola volta: l'operazione aggrega scorte, storico e lista della spesa; mostra un riepilogo conciso di ciò che è cambiato.
8. Il pulsante **Annulla** prima della conferma non modifica mai l'inventario. La bozza rimane recuperabile se si chiude la schermata per errore.

### Scanner: comportamento raccomandato

- Al primo barcode riconosciuto: un solo evento `scan_accept`, feedback distintivo, quantità +1.
- Finché lo stesso barcode resta inquadrato senza interruzione: **zero** scansioni ripetute accidentali.
- Una seconda lettura conta come nuova solo dopo uscita/rientro del codice dall'inquadratura o esplicita azione `+`; se il rilevamento della camera è ambiguo, privilegiare l'assenza di duplicati e `+`.
- Barcode differente: accettazione immediata, senza dover chiudere o riaprire la fotocamera.
- Offline o prodotto non riconosciuto: conservare il codice, offrire `Inserisci nome` oppure `Cerca per nome`, senza bloccare gli altri articoli.
- Permessi camera negati, assenza camera o scansione difficoltosa: ricerca per nome e digitazione manuale barcode sempre disponibili.
- Un barcode non garantisce dati corretti: nome, formato e unità ottenuti da terze parti sono *proposte correggibili*, non informazioni certe.
- Obiettivo d'uso: nessun dettaglio obbligatorio per prodotti già noti; il primo barcode nuovo richiede al massimo i campi indispensabili.

### Carrello temporaneo

- Stato `draft` → `committing` → `committed`, con errori recuperabili; il carrello non deve sparire a causa di un timeout ambiguo.
- Le righe vengono aggregate per prodotto e formato, **ma non** se differiscono in modo significativo variante o unità; righe senza barcode possono avere un'identità temporanea.
- La quantità in carrello è una quantità **acquistata**, non la quantità totale in casa.
- Il prezzo è facoltativo e non è richiesto per confermare l'acquisto.
- La posizione predefinita si ricava dalle ultime scelte in quella **specifica casa**, con modifica rapida.
- Ogni conferma invia un `idempotency_key` univoco. Una ripetizione dovuta a rete instabile recupera l'esito precedente anziché ricreare movimenti.
- La conferma atomica ha un punto unico di verità sul database; mai applicare metà carrello e lasciare l'altra metà sospesa senza comunicarlo.

### Conciliazione con la lista spesa

- Un articolo **manuale** con quantità 4, se ne compri 2, resta in lista per 2.
- Un articolo **automatico** viene ricalcolato dopo il nuovo livello di scorta e non moltiplica le notifiche o le righe al ripetersi dell'evento.
- Se l'articolo acquistato non era in lista, va comunque nelle scorte e nello storico; non crea una richiesta artificiale.
- In mancanza di un match affidabile, non cancellare o marcare complete voci della lista sulla base di nomi simili.
- Una lista condivisa è riferita alla casa, non all'account che ha acquistato.

## 12. Lo stock ibrido nella pratica

### Tre meccanismi, senza imporre un unico modello

1. **Conteggio esatto:** confezioni, bottiglie, rotoli, lattine; es. 3 pacchi di pasta da 500 g. L'unità `confezione` ha il suo formato nominale.
2. **Misura indicativa:** olio già aperto, caffè, farina, sapone; es. `disponibile / quasi finito / finito`. Il sistema non inventa un peso residuo.
3. **Peso o volume effettivo:** alimenti sfusi quando l'utente lo sa (es. 850 g di pomodori), ma il campo è facoltativo e può coesistere con note come «circa».

### Confezioni chiuse e aperte

Caso «pasta»: sono presenti 3 pacchi chiusi e 1 aperto quasi finito. L'interfaccia mostra **«3 chiusi + 1 aperto (quasi finito)»**, non «3,2 confezioni» se 0,2 non è stato misurato.

- Aprire una confezione può essere segnato dalla scheda prodotto; è **opzionale**, non richiesto all'utente per ogni utilizzo.
- Se non si tiene traccia dell'apertura, Casetta conserva il conteggio più semplice e segnala la possibilità di imprecisione.
- La gestione delle scadenze per lotti è prevista dal modello ma non richiede un inventario lotto-per-lotto in V1.

### Distinguere «zero», «non registrato» e «stimato»

- **Mai registrato**: non è equivalente a «esaurito» e non attiva riacquisti automatici.
- **Confermato**: quantità verificata dall'utente o evento di acquisto/consumo registrato.
- **Stimato**: ipotesi calcolata o importata con margine d'incertezza esplicito, mai mostrata come esatta.
- **Da verificare**: informazione troppo vecchia o contraddittoria. L'app suggerisce un controllo occasionale, non impone operazioni quotidiane.

Un acquisto registrato aggiorna le quantità note, ma **non prova** che altri prodotti mai censiti siano assenti; il magazzino iniziale si popola gradualmente. L'onboarding non richiede di censire la casa.

### Consumo in 1–2 tocchi

Dalla ricerca prodotto, da un prodotto abituale o dalla scheda:

- `−1` per unità confezionate;
- `Finito` per segnare l'esaurimento senza calcoli;
- `Quasi finito` per unità che si consumano gradualmente;
- `Correggi` per un riallineamento senza fingere che l'utente abbia consumato o acquistato.

Se l'operazione non è coerente con lo stato attuale (es. `−1` su quantità sconosciuta), chiedere solo il chiarimento necessario; evitare stock negativo non voluto e numeri fittizi.

### Controllo rapido, discreto

- Solo articoli con priorità reale: si stanno per riacquistare, hanno un dato incerto, oppure una scadenza registrata.
- Mostrare un piccolo lotto (es. 3 articoli) quando l'utente apre Casetta, **non** una serie di popup.
- Risposte rapide: `È corretto`, `Quasi finito`, `Finito`, `Non ora`.
- Non riproporre continuamente lo stesso prodotto dopo «Non ora»; gestire un rinvio.
- Eventuali previsioni future non spostano automaticamente quantità da `certe` a `consumate`; richiedono conferma o mostrano una stima separata.

## 13. Schermate e priorità visive

### `Scorte`
- In alto: casa attiva, ricerca immediata e filtro posizione.
- Elenco: nome, formato, disponibilità sintetica e **indicatore testuale** «confermato / stimato / da verificare» quando rilevante.
- Azioni rapide esposte per prodotti frequenti: `−1`, `Finito`, `Quasi finito`.
- Scheda di dettaglio: cronologia movimenti, posizione, scadenza se nota, modalità di monitoraggio, soglia minima, target, correzione.

### `Spesa`
- Schermata iniziale: elenco «Da comprare», raggruppato o filtrabile per manuale / suggerito.
- Azione primaria: `Registra acquisti` → scanner.
- Seconda azione: `Aggiungi alla lista` con ricerca e prodotti frequenti.
- La lista è operativa anche senza stock censito; richieste manuali sono sempre disponibili.

### `Registra acquisti`
- Header sempre visibile: `Casetta attiva` + `Carrello: n prodotti / n pezzi`.
- Area camera e feedback grande, leggibile; pulsanti pausa, ricerca, tastiera barcode.
- Dock carrello aggiornato; quantità regolabili, riepilogo separato dal mirino.
- `Conferma acquisti` solo dalla revisione del carrello, per evitare commit accidentali durante la scansione.

### `Oggi`
- Presenta solo eccezioni utili: lista suggerita, prodotti da verificare, scadenze note.
- Evitare contatori e alert vuoti che richiedono di inventariare tutto per sentirsi «in pari».

## 14. Esempi di casi limite e decisione attesa

| Caso | Comportamento |
|---|---|
| 5 pacchi identici | 1 scansione + quantità 5, oppure scansioni intenzionali ripetute; **1 riga** |
| Camera fissa sullo stesso barcode | Accettare una sola volta finché non viene disinquadrato |
| Pomodori al mercato, senza barcode | Ricerca rapida «pomodori»; peso opzionale o quantità indicativa |
| Prodotto da database con peso sbagliato | Correggere senza alterare il codice originario |
| Nessun inventario iniziale | Stato «non registrato», non «zero»: l'app inizia dai prossimi acquisti |
| Detersivo aperto e mezzo pieno | Livello «disponibile/quasi finito» senza inventare millilitri |
| Lista richiede 4, acquisto 2 | Residuo in lista 2; scorte +2 |
| Due conviventi confermano acquisti | Movimenti applicati atomicamente, senza sovrascritture dell'uno sull'altro |
| Casetta attiva = casa di papà | Destinazione chiaramente indicata prima della conferma, nessuna commistione |
| Connessione persa dopo Conferma | Verificare esito tramite idempotency key; **mai** duplicare acquisti |
| Errore scanner o assenza camera | Aggiunta manuale e ricerca sempre disponibili |
| Vuoi annullare un acquisto confermato | Movimento di rettifica tracciato, non eliminazione invisibile dello storico |

## 15. Accettazione UX da verificare su iPhone reale

1. Camera aperta in HTTPS, con permessi chiari e fallback se negati.
2. Dieci prodotti diversi possono essere aggiunti alla stessa sessione senza riaprire la camera.
3. Lo stesso barcode fermo nell'inquadratura non genera acquisti multipli; `+` modifica la quantità senza nuove ricerche.
4. Con un barcode sconosciuto l'utente può proseguire la spesa, assegnando il nome alla riga non riconosciuta.
5. La conferma di un carrello non richiede di inserire manualmente prezzi e posizioni per ogni riga.
6. Un riavvio del browser non trasforma una bozza in acquisto confermato, né la fa perdere silenziosamente.
7. Quantità `sconosciuta` e quantità `zero` sono visivamente e semanticamente differenti.
8. Un acquisto parziale lascia nella lista esattamente il residuo richiesto, salvo modifiche concorrenti.
9. Un osservatore della casa di papà non può registrare acquisti per quella casa; un editor sì.
10. Le correzioni di stock restano riconoscibili dai consumi e dagli acquisti nello storico.

## 16. Decisioni di prodotto e prossima attività

**Decisioni UX consigliate per l'implementazione, non ancora convalidate da test utente:**
- Nella spesa la camera è il primo schermo; carrello temporaneo unico.
- Il carrello è aggregato per prodotto/formato e consente `+ / −`.
- Lo stock può essere «non registrato»; nessun censimento iniziale obbligatorio.
- Le confezioni aperte possono essere rappresentate separatamente dai pacchi chiusi, in modo non coercitivo.
- Scanner e conferma indicano sempre chiaramente la casa attiva.
- Scadenze e acquisti non pretendono precisione se i dati non esistono.

**Passi successivi:** validare l’onboarding §17-22 e il prototipo cliccabile `Spesa → Scanner → Carrello → Conferma`, poi rifinire lo schema M1/M2 e gli script di migrazione. I prototipi usano dati simulati e non devono fingersi collegati alla camera o al database.


---

# Addendum v0.3 — Onboarding e primo utilizzo

## 17. Obiettivo

Il tempo tra il primo accesso e il primo valore utile deve essere minimo. Il nuovo utente non deve importare né censire le scorte. Una casa completamente nuova **non equivale a una casa senza prodotti**: il sistema non sa ancora cosa contiene.

**Principio:** nessuna configurazione iniziale che non sia strettamente necessaria. Le preferenze verranno apprese o richieste quando servono.

## 18. Percorso di onboarding da realizzare

### 18.1 Account personale

- Schermata pulita con `Accedi` / `Crea account` oppure un ingresso unificato; non richiedere password, nome completo o altri dati personali se non necessari alla modalità Auth scelta.
- **Proposta UX:** accesso tramite email e codice di verifica o link; verifica fattibilità, template, configurazione dei redirect e praticità su iPhone prima di cristallizzarla in codice. Fallback di recupero accesso ben visibile.
- Chiedere il nome visualizzato solo se serve alla collaborazione, e permetterne la modifica successiva.
- Non chiedere accesso alla fotocamera né notifiche in questa fase: richiedere il permesso camera soltanto quando si apre lo scanner; chiedere le notifiche solo dopo aver spiegato il beneficio concreto.

### 18.2 Scelta iniziale per account senza case

- Se il nuovo account apre normalmente l'app: proporre **Crea una casa**; proporre **Accetta invito** solo quando il flusso inviti è disponibile.
- Se arriva da un link di invito, mostrare direttamente la casa invitante e il ruolo proposto dopo il login; non costringerlo a creare prima un'altra casa.
- Se possiede già case, saltare l'onboarding e aprire l'ultima casa valida e accessibile. Se l'accesso è stato revocato, passare alla scelta fra le case ancora accessibili oppure allo stato nessuna casa.

### 18.3 Crea casa — un solo dato richiesto

- Nome breve (precompilato `Casetta mia`, modificabile). Indirizzo, posizione GPS, dimensioni, stanze, numero di abitanti e strumenti domestici **non richiesti**.
- Attribuire automaticamente il creatore come `owner`, in modo atomico con la creazione della casa (funzione SQL controllata/transazione se opportuno).
- Posizioni suggerite soltanto al primo utilizzo: `Dispensa`, `Frigorifero`, `Congelatore`, `Bagno`, `Ripostiglio`; nessun elenco da confermare obbligatoriamente.
- Fuso orario da impostazione del dispositivo o scelta esplicita facoltativa, senza dedurre l'indirizzo fisico.
- Vietare nomi vuoti; se un nome si ripete, l'identità tecnica resta l'ID della casa, non il nome.
- Evitare creazioni duplicate se la risposta di rete è incerta: usare un controllo d'idempotenza lato server per questa mutazione (o equivalente transazionale verificabile).

### 18.4 Prima home, quando non ci sono ancora scorte

Copy proposto:

> La tua casa è pronta. Non serve inserire tutto quello che possiedi: iniziamo dai prossimi acquisti.

CTA principale (quando M2 è effettivamente disponibile): **Registra il primo acquisto**. CTA secondaria (quando M3 è disponibile): **Crea una lista della spesa**. Se disponibile M1 ma non M2: **Aggiungi un prodotto**.

- In M0 mostrare un autentico stato vuoto con le quattro schede `Oggi / Scorte / Spesa / Gestione` e l'area `Gestione` funzionante per le case. Le altre aree devono indicare chiaramente che sono in preparazione: nessuna funzionalità simulata presentata come attiva.
- Non mostrare `0 confezioni`, `0 prodotti in dispensa` o `nessuna cosa da comprare` come affermazioni attendibili finché l'inventario non è stato avviato. L'assenza di record è `non censito`, non `finito`.
- Il primo prodotto inserito o acquistato alimenta il modello senza dover completare prima altre schede.

### 18.5 Primo acquisto (dopo M2)

1. Toccare `Registra il primo acquisto` apre direttamente lo scanner con casa attiva visibile; ricerca/manuale sempre disponibile.
2. Registrare un articolo: il carrello conserva il nuovo prodotto con quantità iniziale 1; informazioni da fonte esterna modificabili.
3. L'utente può aggiungere altri prodotti senza tornare indietro.
4. Conferma unica; stock, movimenti e lista sono aggiornati tramite l'operazione atomica descritta in §11.
5. Il prodotto registrato appare nella home/scorte; nessun secondo wizard, nessuna richiesta di impostare soglie obbligatorie.

### 18.6 Inviti e abitazioni esterne (quando M4 sarà disponibile)

1. Il proprietario genera invito per una casa specifica, specificando ruolo `editor` o `viewer`.
2. Il destinatario autenticato vede **nome della casa**, **nome del mittente quando disponibile**, **permesso concesso**, e pulsanti **Accetta** / **Rifiuta**.
3. La conferma aggiunge un accesso **solo a quella casa**. Non concede accesso reciproco automatico.
4. Se l'invito è scaduto, revocato, già usato da altro account o destinato a un'email diversa, mostrare un errore recuperabile, senza esporre dati privati della casa.
5. Un osservatore vede una UI di sola lettura; non mostrare pulsanti di acquisto/modifica abilitati. **La sicurezza non dipende da nascondere i pulsanti:** RLS/API devono negare le mutazioni.
6. Accessi guest e resident possono essere distinti anche con lo stesso ruolo; la condivisione delle sezioni granulari non fa parte della V1.

## 19. Navigazione fra più abitazioni

- Mostrare sempre l'abitazione attiva nell'intestazione. Un tocco apre il selettore con ruolo (`Proprietario`, `Può modificare`, `Sola lettura`).
- L'utente può usare più case senza ri-autenticarsi o condividere le proprie credenziali.
- Ogni bozza di acquisto, lista e operazione è collegata in modo immutabile alla `home_id` di origine. Durante una bozza, chiedere di completare, sospendere o annullare prima di cambiare casa; non trasferire mai automaticamente il carrello.
- Prima di confermare una mutazione in casa altrui mostrare chiaramente `Stai registrando per: Casetta papà` (senza introdurre conferme aggiuntive non necessarie ogni volta se l'utente è già consapevole della casa attiva).
- Persistenza dell'ultima casa attiva **solo come preferenza locale**: al ritorno verificare sempre che l'account ne abbia ancora accesso; mai usare un ID salvato come autorizzazione.

## 20. Schermate e stati da gestire

| Stato | Interfaccia e comportamento |
|---|---|
| Non autenticato | Benvenuto / accesso, errori leggibili e modalità di recupero |
| Autenticato senza case | Crea una casa; accetta invito quando funzionale |
| Creazione casa in corso | Stato di caricamento, azione disabilitata per evitare doppi invii |
| Creazione riuscita | Home vuota della nuova casa, senza inventario artificiale |
| Errore rete in creazione | Non raddoppiare case; verificare esito e permettere ripresa |
| Invito ricevuto | Dettaglio casa e ruolo, accettazione esplicita |
| Invito scaduto/revocato | Messaggio neutro e recuperabile; chiedere un nuovo invito |
| Casetta accessibile in sola lettura | UI di consultazione; write action disabilitate e rifiutate da RLS |
| Revoca dell'ultima casa | Stato «nessuna casa accessibile», senza dati cache dell'ultima casa |
| Scorte mai censite | Stato `non registrato`; mai confondere con `zero` |
| Prodotto già presente | Risultato ricerca/scansione collegato allo stock della casa attiva |

## 21. Gestione dati e sicurezza onboarding

- Proporre autentificazione senza dati personali non necessari, senza geolocalizzazione richiesta per creare la casa.
- Per la proprietà e l'accesso usare ID stabili + policy RLS. La relazione tra utente e abitazione resta autonoma dai contatti personali e dall'email.
- La creazione della casa e della membership owner devono essere atomiche; nessuna casa senza proprietario per errori parziali.
- Evitare che un utente possa dichiararsi owner di una casa altrui inserendo arbitrariamente `home_id` o `role` nella richiesta.
- Non memorizzare token d'invito in chiaro nel database, utilizzare digest/hash a scadenza. Evitare di includere dati della casa nelle anteprime pubbliche degli inviti.
- Se il flusso di invito non è ancora implementato, non rendere disponibile un'accettazione fittizia.

## 22. Criteri di accettazione onboarding

1. Utente nuovo crea una casa fornendo solo il nome, senza inventariare alcunché.
2. Utente nuovo che riceve un invito, quando gli inviti sono attivi, può accettarlo senza creare una casa personale.
3. Nessun dato della casa di un altro account appare finché non esiste un accesso esplicito valido.
4. Due case distinte con lo stesso nome restano totalmente isolate.
5. Nessuna quantità mancante viene presentata come zero certo.
6. In M0 non compaiono pulsanti funzionanti fittizi per prodotti, scanner o lista.
7. Refresh/re-login riporta alla casa accessibile appropriata e non richiede ripetere onboarding.
8. Un errore temporaneo durante la creazione non genera doppie case.
9. La revoca accesso interrompe la consultazione e impedisce mutazioni indipendentemente dallo stato della UI.
10. Su schermo iPhone piccolo, campi e azioni principali rimangono raggiungibili e leggibili, anche con tastiera aperta.

## 23. Priorità dopo l'addendum

- **Confermato come direzione UX:** onboarding progressivo, casa senza inventario iniziale, separazione persona/casa, accesso per invitati senza possesso di un'abitazione, nessun falso zero.
- **Da validare in M0:** modalità precisa di autenticazione, comportamento link email/codice su Safari e PWA iOS, gestione redirect e sessione.
- **Da validare con utenti reali:** chiarezza dei testi per persone poco tecniche, comportamento del selettore fra più case e primo acquisto da fotocamera.
