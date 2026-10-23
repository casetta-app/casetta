# CASETTA — Specifica di prodotto e architettura v0.5

**Data:** 23 ottobre 2026
**Stato:** specifica di riallineamento completa; riferimento per progettazione, implementazione e test, **non** dichiarazione di funzionalità già disponibili.
**Sostituisce nella direzione di prodotto:** la v0.3, che rimane documento storico e riferimento per funzioni tecniche già realizzate.
**Ambizione:** Casetta deve diventare un vero assistente domestico intelligente. Le fasi di implementazione non autorizzano a ridurre il risultato finale a un calendario, a un inventario o a un lettore OCR con etichette accattivanti.

## 0. Registro delle decisioni

### Decisioni confermate nella conversazione

1. **Obiettivo unico: «svuotare il cervello delle persone».** Casetta toglie dall'attenzione quotidiana ciò che si deve ricordare, ricercare, organizzare o ripetere.
2. **Perimetro domestico**, non un'app universale di produttività professionale. L'auto, gli animali, le utenze e i beni pertinenti alla vita domestica rientrano nel perimetro, anche se non sono fisicamente nell'abitazione.
3. **Basso attrito radicale:** niente censimento iniziale di oggetti o registrazione quotidiana dei consumi. Funzioni di stock puntuale non devono imporsi nell'interfaccia ordinaria.
4. **Acquisizione preferita tramite foto e voce**, con testo come alternativa. Lo scontrino fotografato è il canale primario per apprendere acquisti, prezzi e frequenze.
5. **Sempre riepilogo prima della registrazione dell'intera spesa.** L'utente deve poter correggere e confermare una volta; l'incertezza di alcune righe non blocca tutte le altre.
6. **Spese e prezzi sono funzioni centrali:** totale mensile, categorie, storico dei prezzi, andamento, confronti al prezzo unitario e convenienza.
7. **L'assistente deve imparare le abitudini**, adattarsi nel tempo e distinguere fatti verificati, stime e situazioni temporanee.
8. **Suggerimenti ordinari, come «forse serve il latte», quando si apre l'app.** La richiesta può proporre «Aggiungi», «Non serve», «Più tardi»; non modifica da sola la lista.
9. **Notifiche esterne per scadenze importanti**, con solleciti ragionevoli finché l'incombenza non è stata risolta. Stop dopo conferma; non inventare nuove date.
10. **Questionario iniziale approfondito nel valore, breve nell'attrito:** colloquio adattivo anche vocale, orientato a un risultato operativo immediato. Apprendimento successivo contestuale, non un interrogatorio.
11. **Memoria documentale domestica:** conservare originali, estrarre informazioni, associarle a cose, attività, costi, scadenze e altri documenti, ritrovarle negli anni.
12. **Calendario dell'iPhone:** gli impegni domestici devono poter apparire anche lì, evitando doppio inserimento. La sincronizzazione bidirezionale non va promessa senza una soluzione collaudata.
13. **Offerte personalizzate dei negozi abituali**, a partire da un caso pilota come Conad Poggiardo, incrociate con storico acquisti e bisogno plausibile; no pubblicità indiscriminata.
14. **Costo ricorrente target: 0 €/mese per uso personale**, usando livelli gratuiti e soluzioni locali quando sufficienti; le funzioni essenziali non devono essere finte o inaffidabili per rispettare artificialmente il vincolo.
15. **Casa, persona e diritti di accesso sono distinti.** Nessuna condivisione automatica di documenti privati; più abitazioni e invitati autorizzati.
16. **Preservare l'implementazione già esistente**: auth, case, RLS, catalogo, scanner e codice delle scorte. Non confondere componenti riutilizzabili con il prodotto finale.

### Decisioni ancora tecniche, NON assunte come risolte

- Motore di riconoscimento reale su iPhone: qualità OCR, parsing scontrini italiani, audio/STT, performance e consumi.
- Fornitore e disegno del motore di promemoria affidabile in background con piano gratuito: il solo Supabase Free può essere sospeso per inattività.
- Fonte e condizioni di utilizzo dei volantini, disponibilità di prezzi strutturati, matching prodotti, rispetto dei limiti/licenze.
- Esatta interfaccia di integrazione con Calendario iPhone, in particolare sincronizzazione, privacy dei link e gestione delle modifiche esterne.
- Separazione e concessione di accesso a documenti personali su dispositivi o abitazioni condivisi.

Questi punti richiedono prototipi e collaudi specifici; non sono pretesti per cancellare le capacità concordate.

---

## 1. Visione e criteri non negoziabili

**Missione:** Casetta è un assistente per l'amministrazione quotidiana della casa. Riceve informazioni in modo naturale, ne capisce il significato, le collega a una memoria privata, anticipa necessità e segue le questioni aperte fino alla chiusura.

Il modello mentale è quello di un'assistente che lavora da anni nella stessa casa: conosce persone, responsabilità, preferenze, documenti, fornitori, acquisti, ricorrenze, cose da controllare e casi eccezionali; fa domande solo quando il beneficio è evidente.

**Una nuova funzionalità si accetta soltanto se:**
- riduce l'impegno ricorrente rispetto ad app separate o foglietti;
- conserva l'informazione per il riuso, anziché farla riscrivere;
- permette di controllare o annullare quanto interpretato;
- rende esplicita l'incertezza senza fingere conoscenza;
- non richiede una manutenzione manuale continua dei dati.

**Non obiettivi:** catalogare perfettamente ogni oggetto; monitorare ogni consumo domestico; inviare promozioni generiche; sostituire l'agenda professionale; registrare passivamente e senza consenso l'attività di una persona; automatizzare acquisti o pagamenti senza autorizzazione.

## 2. Perimetro: persona, casa, responsabilità

Entità distinte: **account/persona**, **abitazione**, **responsabilità domestica**, **bene/impianto/animale/servizio**, **evento**, **documento**. Una responsabilità (per esempio assicurazione RCA, veterinario, manutenzione caldaia) può riguardare la casa pur non essendo un oggetto collocato in una stanza.

- Ogni evento ha un titolare (`user` oppure `home`) e un ambito di visibilità esplicito.
- Una persona può avere più case; una casa più persone, con ruoli e revoca.
- Un veicolo personale può essere collegato a una casa per finalità operative senza rendere automaticamente accessibili tutti i suoi documenti ai conviventi.
- Gli appuntamenti di lavoro restano fuori da Casetta, a meno che l'utente scelga esplicitamente un'integrazione o un collegamento pertinente.

## 3. Esperienza di primo avvio — colloquio propedeutico

**Obiettivo:** finire con un assistente già configurato sulle proprie priorità e almeno un risultato utile; non una pagina «profilo completato».

### 3.1 Percorso iniziale

1. Accesso, creazione o selezione di una casa (nome soltanto se nuova; nessun indirizzo obbligatorio).
2. Casetta chiede in modo naturale: **«Quali cose tendi a dimenticare o ti pesa organizzare nella gestione della casa?»** Risposta vocale o testuale, con esempi rapidi per chi non sa cosa dire.
3. Estrae **intenzioni operative confermabili**, non etichette arbitrarie. Esempio: bollette e auto → `scadenze`, `utenze`, `veicolo`.
4. Pone 2–5 domande condizionali ad alta utilità: chi gestisce la casa; responsabilità rilevanti (auto, animali, impianti); dove fa abitualmente la spesa; cosa usa oggi (Calendario iPhone, lista spesa); come desidera gli avvisi.
5. Mostra **«Questo è ciò che ho capito»** in una schermata modificabile con privacy/visibilità delle informazioni importanti.
6. Propone una sola prima delega reale: scadenza, foto documento/scontrino oppure attività ricorrente. Se l'utente salta, Oggi offre azioni pertinenti ma non inventa scadenze.
7. Completa con una home Oggi personalizzata, non una dashboard invasa da suggerimenti di configurazione.

### 3.2 Regole

- Colloquio progressivo, riprendibile e facoltativo eccetto dati tecnicamente indispensabili.
- La domanda «Hai un'auto?» serve a *offrire* un flusso di assicurazione/bollo/revisione, non a generare scadenze fittizie.
- Non chiedere scorte iniziali né quantità consumate. Non chiedere targa, indirizzi, dati sensibili prima che siano necessari.
- Una domanda compare solo se ha una conseguenza concreta nella configurazione.
- Memorizzare le risposte come preferenze modificabili, con fonte «dichiarato dall'utente» e visibilità appropriata.
- Non affidarsi a un LLM a pagamento per rendere possibile l'onboarding: il flusso adattivo e una via manuale funzionano anche con classificazione locale e opzioni esplicite.

**Criterio di accettazione:** un nuovo utente deve poter registrare almeno un vero promemoria domestico e ritrovarlo in Oggi senza dover creare un prodotto o completare una scheda inventario.

## 4. Navigazione e modello di interazione

**Proposta di architettura informativa mobile (da validare su iPhone):**

- **Oggi:** cose urgenti, prossime scadenze, impegni, questioni aperte, massimo pochi suggerimenti veramente pertinenti.
- **Agenda:** calendario domestico e attività, anche ricorrenti, con vista tempo e stati di risoluzione.
- **Spesa:** lista tipo Bring, spese recenti, acquisizione scontrino, accesso al riepilogo economico.
- **Archivio:** ricerca unificata fra documenti, beni, veicoli, impianti, utenze e storia; separazione esplicita personale/casa.
- **Aggiungi (azione primaria):** foto/documento, voce e testo; Casetta interpreta l'intento e propone l'azione pertinente. L'eventuale scanner barcode è strumento contestuale secondario.
- **Casa e preferenze:** cambio abitazione, membri, privacy, memoria, esportazione, preferenze notifiche.

Le categorie interne non devono diventare una tassonomia che l'utente è tenuto a navigare per ogni operazione. UI accessibile con una mano, app PWA iPhone reale, aree cliccabili ampie, schermate comprensibili, nessun falso pulsante.

## 5. Pipeline universale di acquisizione

`cattura → rileva tipo → estrai campi → cerca collegamenti → stima certezza → riepilogo → conferma → registra evento/attività/documento → aggiorna viste/apprendimento`

Input supportati come obiettivo di prodotto:
- foto singola e multipla, PDF/documenti, condivisione da iPhone;
- messaggio testuale; audio dettato/registrato con trascrizione e testo correggibile;
- dati già disponibili nel calendario o da importazioni autorizzate;
- barcode solo dove aggiunge valore, **non** come passaggio obbligatorio della spesa.

La cattura grezza non implica un'azione già applicata. La bozza resta distinta dai dati confermati e recuperabile dopo errore di rete. La stessa evidenza non deve produrre registrazioni duplicate. Se l'interpretazione fallisce, offrire una correzione mirata, non un formulario generalista vuoto.

**Una conferma, più aggiornamenti coerenti:** ad esempio un'assicurazione confermata archivia il documento, collega il veicolo, registra la scadenza, crea una pratica aperta e pianifica il promemoria. Conservare traccia del documento originario e della conferma.

## 6. Agenda, scadenze, incombenze e follow-up

### 6.1 Modello delle attività

Una `responsibility/task` dispone di: titolo, soggetto collegato, casa o proprietario, data/ora e fuso, tipo (`appointment`, `deadline`, `maintenance`, `payment`, `chore`, `follow_up`), importanza, eventuale ricorrenza, stato, fonte, prossima azione, piano notifiche, storico e documenti.

Stati distinti: `open`, `in_progress`, `snoozed`, `completed`, `cancelled`, `needs_verification`; `overdue` è una condizione derivata e non cancella gli stati precedenti.

Una ricorrenza può essere:
- calendario (ogni 3 mesi, annuale, determinato giorno del mese);
- derivata da un documento con prossima data certa;
- collegata a un'attività completata (prossimo controllo X mesi dopo l'intervento);
- **proposta** statisticamente, mai trattata come obbligo legale confermato.

Il pagamento semestrale di una RCA e la scadenza della copertura non sono necessariamente la stessa cosa. Per bollo/revisione non determinare scadenze normative senza regole valide, dati del veicolo e verifiche correnti; in assenza di certezza chiedere un documento o proporre controllo.

### 6.2 Politica di attenzione

- **Push fuori dall'app** solo per appuntamenti/scadenze importanti confermati, in base a preferenze e permessi.
- **Suggerimenti predittivi** («probabilmente servirà latte») solo in Oggi all'apertura, non push ordinari.
- Un promemoria importante fa follow-up finché non risulta gestito, con intervalli coerenti, rinvio e limite anti-disturbo; non mandare lo stesso avviso dopo `completed`.
- «Fatto» chiude il compito, ma non inventa dati ulteriori (nuovo importo, polizza rinnovata, prossima scadenza).
- Evidenziare scadenze imminenti anche se l'utente ha disabilitato notifiche, e segnalare esplicitamente che gli avvisi esterni non sono attivi.
- Idempotenza nell'invio, registrazione di tentativi/esiti, trattamento del fuso e dell'ora legale.

### 6.3 Calendario dell'iPhone

Obiettivo utente: gli eventi domestici si consultano insieme agli altri impegni, senza reinserirli. **Prima integrazione verificabile**: calendario Casetta dedicato in sottoscrizione iCalendar, con token revocabile e documentazione dei limiti (refresh, visibilità e notifiche). Alternativa: esportazione/aggiunta di singolo evento dove migliore. **Bidirezionalità** soltanto con un provider/API e una gestione dei conflitti realmente implementati e collaudati: non equipararla alla sottoscrizione ICS. Proteggere nomi/dettagli sensibili nella feed; supportare calendario sintetico con soli titoli non riservati.

## 7. Acquisizione documenti e memoria domestica

Un documento è una **evidenza**, non una cartella statica. Tipi di riferimento: polizza, bolletta, fattura, ricevuta, garanzia, preventivo, contratto, manuale, referto veterinario pertinenti, documenti generici.

Per ogni documento:
- file originale e/o scansione, versioni e hash anti-duplicato;
- proprietario e visibilità, data acquisizione, eventuale data originale;
- testo estratto, campi strutturati, qualità/confidenza, provenienza di ciascun campo;
- collegamenti a soggetti, spese, attività e scadenze;
- conferma/correzione, cronologia revisioni e ricerca;
- esportazione e cancellazione comprensibili, conservazione minima necessaria.

**Esempio RCA:** foto → suggerisce tipo polizza, eventuale targa, compagnia, importo, scadenza (se leggibile) → propone collegamento a veicolo già noto → l'utente conferma → una scadenza reale viene programmata. Il rinnovo successivo può proporre l'aggiornamento dei dati precedenti senza cancellare la storia.

**Esempio lavatrice:** ricevuta → bene, data acquisto e prezzo → garanzia se verificabile → eventuale manutenzione. Una data di garanzia non va inferita come fatto certo senza base giuridica o documentale.

La privacy vince sulla comodità quando un documento personale rischia di finire automaticamente nella memoria condivisa dell'abitazione.

## 8. Scontrino come interfaccia principale della spesa

### 8.1 Flusso normale

1. Dopo la spesa si fotografa lo scontrino (anche più inquadrature per scontrini lunghi).
2. Casetta rileva esercente, punto vendita se disponibile, data/ora, valuta, totale, eventuali sconti, imposte, righe, quantità e prezzi; mostra il testo originale per correggere abbreviazioni.
3. Associa il negozio all'esercente già noto e le righe a prodotti/varianti già visti, **solo quando la confidenza è sufficiente**; può imparare che `LAT P.S. 1L` indica un prodotto già confermato in quello specifico esercente.
4. Mostra **sempre un riepilogo revisionabile dell'intera spesa**: righe sicure, righe da verificare, prezzi, sconti e riconciliazione col totale stampato.
5. L'utente corregge solo ciò che ritiene necessario e preme **Conferma e registra spesa** una volta.
6. Transazione idempotente: evento acquisto, voci economiche, collegamenti documentali, cronologia prezzi, apprendimento, eventuale riconciliazione con lista spesa, senza doppi conteggi.
7. L'originale rimane ricercabile, soggetto a limiti di conservazione ed esportazione.

### 8.2 Regole contabili essenziali

- Distinguere `unit_price`, `line_gross`, `line_discount`, `line_net`, `receipt_total`, sconti sull'intero carrello, coupon, resi, buoni, arrotondamenti e imposte. Non applicare sconti arbitrariamente alle righe se lo scontrino non li dettaglia.
- Memorizzare denaro in centesimi (interi), valuta per transazione; quantità/unità e formati normalizzati quando possibile.
- Conservare sia la dicitura originale dello scontrino sia l'identità commerciale normalizzata; le etichette brevi non sono prova certa del prodotto.
- L'importo della spesa rimane contabilizzato anche se alcune righe non sono identificate: **completezza finanziaria** e **completezza di classificazione** sono diverse.
- Se totale righe + rettifiche non coincide col totale stampato, mostrare differenza e provenienza; l'utente può salvare con stato `needs_review` se la situazione lo richiede, senza certificare una riconciliazione inesistente.
- Evitare doppia acquisizione tramite hash, negozio/data/totale e conferma sull'eventuale duplicato; non assumere che scontrini identici per importo siano sempre duplicati.
- La scansione dello scontrino non prova cosa sia rimasto in casa e non impone consumi futuri.

### 8.3 Scontrino difficile

- Foto storta, sfocata, sbiadita, lunghezza elevata: ritaglio, contrasto, rotazione e foto multiple; segnalazione qualità e nuovo scatto quando serve.
- Voci come `DET.LAV 32L`: proporre un nome solo se fondato su storico/corrispondenze attendibili; conservare originale altrimenti.
- Un test di riconoscimento non è completo senza una verifica **su scontrini italiani reali** con importi, promozioni, resi e più aliquote.

## 9. Economia domestica e prezzi

La sezione economica deve rispondere a domande reali:

- Quanto è stato **registrato** come spesa domestica questo mese? Per quali categorie?
- Quanto ho speso al supermercato, per auto, utenze, animali, manutenzioni?
- Quanto ho pagato un dato articolo in negozi e periodi diversi? Qual è il prezzo per kg/l/pezzo a parità di prodotto/formato?
- Quanto sono cambiati i prezzi rispetto ai miei acquisti osservati?
- Quali importi ricorrenti o straordinari richiedono attenzione?

Separare spesa registrata e bilancio **completo**: senza tutte le transazioni non affermare che il totale mensile sia il totale effettivamente sostenuto. Evitare doppi conteggi tra scontrino e successivo pagamento bancario se tale integrazione verrà introdotta. Categoria economica distinta dalla categoria di prodotto. Ogni cifra deve essere navigabile fino alla fonte.

**Costi di possesso:** un'auto o un impianto può avere prezzo di acquisto, spese di manutenzione, polizze, imposte e documenti collegati. L'app può ricostruirne lo storico senza pretendere di sapere automaticamente ogni costo sostenuto.

## 10. Lista spesa e apprendimento non coercitivo

La lista è semplice, rapida, condivisibile nell'abitazione autorizzata: aggiunta voce a mano, per voce o da suggerimento; spunta, quantità facoltativa, note e prodotti ricorrenti. Non servono barcode, ubicazione in dispensa o quantità residue per usarla.

Quando uno scontrino confermato contiene un prodotto in lista, Casetta può proporre di marcarlo acquistato; associazioni dubbie richiedono conferma. Una lista può funzionare anche senza scontrini.

**Modello abitudini:** derivare dalla serie temporale di acquisti confermati una frequenza attesa con intervallo di incertezza; considerare quantità/formato, stagionalità osservata, acquisti straordinari, dati mancanti, rifiuti dei suggerimenti. Non spacciare una stima per quantità fisica residua.

**Esperienza confermata:** quando si apre Oggi, un suggerimento utile può dire «Di solito in questo periodo compri il latte. Vuoi aggiungerlo alla prossima spesa?» con `Aggiungi`, `Non serve`, `Più tardi`; nulla viene aggiunto senza approvazione. Spiegazione `Perché lo suggerisci?`; pausa e correzione dell'abitudine.

Lo storico delle quantità rimane un motore accessorio per chi ha necessità particolari, non una schermata predefinita con `−1`, `Quasi finito`, `Finito` ripetuti per ogni articolo.

## 11. Offerte personalizzate: obiettivo esplicito di Casetta

**Caso pilota richiesto:** punto vendita abituale Conad a Poggiardo, con offerte ufficialmente reperibili e utilizzabili, verificando disponibilità effettiva della fonte, termini, formati, date e copertura.

Funzione attesa:

1. Associare negozio preferito e prodotti acquistati abitualmente.
2. Acquisire offerte lecite, attuali e attribuibili al punto vendita; registrare validità e fonte.
3. Collegarle a prodotti comparabili mediante marca, variante, formato, unità di misura; **non** confondere articoli diversi soltanto per nome simile.
4. Calcolare prezzo unitario e confrontarlo con storico personale osservato, evidenziando qualità del confronto.
5. Mostrare in-app poche offerte pertinenti in rapporto a una necessità plausibile, **senza** spingere all'acquisto di cose inutili.
6. Non affermare disponibilità in negozio, prezzo effettivo alla cassa o promozione valida se la fonte non li conferma.
7. Avere fallback esplicito se volantino/PDF non è disponibile o il recupero non è autorizzato; niente scraping indiscriminato.

Questo modulo è nel **prodotto-obiettivo**, non un'idea da abbandonare. Il pilota deve essere verificato end-to-end prima di dichiararlo funzionante; la copertura di catene diverse è espansione successiva.

## 12. Memoria domestica: struttura e apprendimento

### 12.1 Quattro classi di memoria

1. **Dichiarata/stabile:** casa attiva, preferenze, supermarket abituale, beni/animali/impianti dichiarati; modificabile dall'utente.
2. **Storica/evidenziale:** acquisti, documenti, interventi, pagamenti, appuntamenti e loro date; immutabilità logica con correzioni versionate, non cancellazione silenziosa.
3. **Appresa:** frequenze, periodi, abitudini, prodotti preferiti, sensibilità ai suggerimenti, con periodo di osservazione e confidenza; decadimento quando cambia il comportamento.
4. **Temporanea:** ospiti questa settimana, trasloco imminente, necessità eccezionale; validità temporale e scadenza automatica del contesto.

### 12.2 Provenienza, confidenza, spiegazione

Per ogni fatto utile: `valore`, `soggetto`, `fonte/evidence_id`, `data_estrazione`, `data_validità`, `stato` (`proposed`, `confirmed`, `inferred`, `superseded`, `disputed`), eventuale `confidence`, autore conferma. Mai far passare inferenza per fatto confermato.

Nelle proposte mostrare, su richiesta, `Perché Casetta me lo suggerisce?` con osservazioni principali e limite dell'inferenza. Possibilità di «Non suggerirlo più», correggere, dimenticare o reimpostare quanto appreso, conservando lo storico necessario solo se autorizzato.

### 12.3 Collegamenti

Un evento può essere collegato a più soggetti: documento assicurativo ↔ polizza ↔ automobile ↔ pagamento ↔ scadenza; fattura idraulico ↔ impianto ↔ intervento ↔ spesa. La correlazione automatica va proposta soltanto se affidabile; le ipotesi diventano relazioni confermate con decisione dell'utente o una regola dichiarata trasparente.

## 13. Sicurezza, privacy e controllo

- RLS sul database, controlli server-side per ogni ruolo e abitazione; separare documento personale da documento dell'abitazione.
- Supabase Storage in bucket privati, percorsi non prevedibili, link temporanei e revocabili; non inserire documenti riservati nei repo GitHub o negli URL pubblici.
- Campo sensibile (targa, indirizzo, documento, nome animale/persona, dati di pagamento) trattato con minimizzazione e accesso strettamente necessario.
- Estrazione lato dispositivo dove possibile; nessun invio a fornitori IA esterni senza informativa e autorizzazione esplicita, se introdotti.
- Non promettere crittografia end-to-end mentre il server deve elaborare documenti in chiaro; l'eventuale E2EE richiede gestione chiavi e scelte specifiche.
- No conservazione indefinita di audio grezzo, foto intermedie e bozze abbandonate senza necessità; policy di retention esplicita.
- Esportazione completa e leggibile (dati strutturati e originali), cancellazione e backup ripristinabile; non pubblicare token, firmare connessioni sicure.
- Log di audit per modifiche e invio promemoria, senza scrivere testo di documenti riservati nei log applicativi.
- Supportare accessi da più case senza mescolare dati, compresi ricerca, cache, suggerimenti e feed calendario.

## 14. Affidabilità, costi e integrazioni realistiche

### 14.1 Budget

**Target progettuale per uso personale:** 0 €/mese. Le quote gratuite sono risorse limitate, non garanzie di disponibilità per sempre. La v0.5 non può dichiarare un motore intelligente generale gratuito e infallibile senza prove.

Situazione infrastrutturale attuale: GitHub Pages + Supabase Free. A ottobre 2026 Supabase dichiara 500 MB di database, 1 GB di file storage, 500.000 invocazioni Edge Function/mese; i progetti Free possono essere sospesi dopo una settimana di attività insufficiente. Verificare sempre i termini prima del rilascio.

### 14.2 Motore di notifiche: rischio bloccante

La PWA iPhone può ricevere Web Push quando aggiunta alla schermata Home, dopo consenso, ma serve un server in grado di inviare messaggi programmati indipendentemente dall'app aperta.

**Non accettabile:** basare un promemoria importante soltanto su un timer del browser, un processo sul Mac dell'utente, o una pianificazione che smette di funzionare quando Supabase Free viene sospeso.

**Spike obbligatorio:** confrontare un scheduler gratuito indipendente (per esempio Cloudflare Workers Cron con eventuale stato minimo durevole), integrazione affidabile calendario, o altra architettura con gestione delle code. Verificare idempotenza, sicurezza, autorizzazioni, ritardi, revoche e prova con dispositivo chiuso; non duplicare in due archivi la verità delle scadenze senza un protocollo di sincronizzazione.

**Gate di rilascio:** test reali di notifica con app chiusa, fusi orari, ora legale, assenza di rete, riavvio dispositivo, rinvio e chiusura attività; test di inattività dell'app prolungata. Se non soddisfatto, dichiarare il limite ed evitare di presentare i push come protezione affidabile di una scadenza critica.

### 14.3 OCR, comprensione, voce

- Iniziare con una prova tecnica verificabile di OCR lato client con strumenti open source (es. Tesseract.js) e preprocessing; misurare qualità reale di nomi, importi, righe, sconti e totali su iPhone. Se insufficiente per lo standard Casetta, valutare un'elaborazione alternativa senza abbassare tacitamente l'obiettivo.
- Distinguere riconoscimento testo, parsing di layout, normalizzazione articoli e interpretazione semantica: sono quattro problemi diversi.
- Voce: testare dettatura di sistema e percorsi reali di registrazione/trascrizione disponibili sull'iPhone; la semplice presenza di un pulsante microfono non equivale a una funzione vocale valida. Sempre testo riconosciuto revisionabile.
- Algoritmi statistici locali/server gratuiti per memoria e trend; niente chiamata LLM per ogni evento se non giustificata e finanziata.
- Qualora un servizio commerciale diventi indispensabile per raggiungere qualità accettabile, presentare costo e trade-off prima di attivarlo: il requisito di qualità non va nascosto dietro un'interfaccia che simula intelligenza.

### 14.4 Altri vincoli

- I feed calendario possono essere in sola lettura e aggiornarsi con ritardo; URL protetti/revocabili e nessun documento riservato esposto.
- Le offerte dipendono dall'accessibilità e dalla licenza delle fonti; qualità e disponibilità non presumibili.
- Salvataggio offline di bozze ove fattibile; nessuna sincronizzazione fantasma o doppio commit.
- Strumenti di esportazione/backup sono requisito, dato che il piano gratuito non garantisce backup quotidiani gestiti.

## 15. Architettura logica proposta: evolvere, non riscrivere

### 15.1 Fondazioni già esistenti (preservare)

- React/Vite/TypeScript PWA su GitHub Pages, navigazione e autenticazione;
- Supabase Auth, case e isolamento dati tramite RLS;
- inventario ibrido e operazioni atomiche, catalogo locale e barcode;
- scansione iPhone; adattatore Open Food Facts per il **dominio alimentare**, non classificatore universale di prodotti;
- migrazioni `202610220001`–`202610220004`, test DB/UI, asset e dati esistenti.

La v0.3 descrive ancora questi comportamenti tecnici ed è utile per compatibilità, ma **non** definisce la priorità UX della v0.5. Non rimuovere tabelle in uso né riscrivere migrazioni applicate; nuove strutture tramite migrazioni additive versionate e rollback pianificati.

### 15.2 Domini nuovi e confini

| Dominio | Responsabilità | Esempi di entità candidate |
|---|---|---|
| Identità e accesso | utenti, case, condivisioni | `homes`, `home_access`, regole visibilità personale |
| Inbox acquisizioni | upload, OCR/audio, bozze, revisione | `captures`, `capture_extractions`, `capture_drafts` |
| Memoria/evidenze | documenti, attributi, collegamenti | `documents`, `evidence_facts`, `subjects`, `subject_links` |
| Responsabilità | attività, ricorrenze, solleciti | `tasks`, `recurrence_rules`, `reminder_plans`, `notification_deliveries` |
| Economia | transazioni, righe, spese e costi | `purchases`, `purchase_lines`, `expense_entries`, `merchants`, `price_observations` |
| Spesa | lista, prodotti abituali, stati | `shopping_items`, `product_aliases`, collegamento all'inventario esistente |
| Apprendimento | modelli, feedback, suggerimenti | `habit_models`, `suggestions`, `suggestion_feedback` |
| Opportunità | volantini e offerte verificate | `retailer_offers`, `offer_matches` |
| Calendario | feed, integrazioni, stato sincronizzazione | `calendar_feeds`, `calendar_sync_links` |

Questi sono **confini logici**, non un ordine a Codex di creare subito tutte le tabelle. Per la prima migrazione occorre definire chiavi, FK, accessi, idempotenza, retention e indici con test. Non concentrare ogni dato in un JSON generico né creare duplicati di entità già presenti.

### 15.3 Evento come fonte primaria

Gli eventi registrati e i documenti confermati costituiscono la **memoria storica**. Lo stato corrente di una polizza, di una lista, di una scadenza o di un'abitudine è una vista/materializzazione derivata e correggibile, mai un'invenzione scollegata da una fonte.

Ogni comando importante deve avere: `actor`, `scope`, `idempotency_key`, timestamp, transazione/risultato, provenienza e versione. Gestione di concorrenza, retry e doppio upload obbligatoria.

## 16. Definizione della V1 completa — senza tagliare il prodotto

**V1 non è il primo prototipo.** È il primo rilascio che svolge davvero il ruolo di assistente domestico: riceve informazioni, le collega, le ricorda, mostra le spese e apprende abbastanza da fare suggerimenti pertinenti. Non si dichiara V1 perché funziona un calendario o perché legge un barcode.

| Capacità richiesta alla V1 | Prova minima sul dispositivo reale |
|---|---|
| Onboarding conversazionale e adattivo | priorità configurate, profilo correggibile, prima delega reale |
| Oggi/Agenda | attività, scadenze, rinvio, completamento, ricorrenze, follow-up |
| Promemoria affidabili | push/iPhone o soluzione equivalente collaudata con app chiusa; limiti esplicitati |
| Acquisizione foto/documenti | file privato, estrazione verificabile, riepilogo, associazione, storico |
| Acquisizione vocale | voce → testo revisionabile → azione domestica proposta → conferma su iPhone |
| Scontrini | almeno casi italiani realistici, totale/righe/sconti, revisione, commit univoco |
| Spese e prezzi | viste mensili, categorie, prezzo per unità e storico navigabile alla fonte |
| Lista della spesa | input rapido, voce/testo, relazione con acquisti e suggerimenti |
| Memoria collegata | veicolo/utenza/bene ↔ documenti ↔ spesa ↔ scadenze |
| Apprendimento non invasivo | frequenze e correzioni visibili, suggerimento latte solo in Oggi su conferma |
| Offerte mirate | pilota reale di almeno una fonte utilizzabile, match verificato e fonte visibile; fallback se indisponibile |
| Riservatezza e controllo | isolamento personali/casa, revoca, correzione, export e backup testato |
| Calendario iPhone | almeno una integrazione valida, documentati limiti e privacy |

**Non necessari alla V1 completa** soltanto: interoperabilità con ogni banca/negozio/calendario, IA generativa universale capace di capire ogni documento, copertura di tutti i supermercati, acquisti automatici, gestione di ogni tipologia specialistica e sincronizzazione Apple bidirezionale non verificata. Questi limiti di copertura non devono eliminare i flussi core elencati sopra.

## 17. Piano di realizzazione con milestone verticali e test

Le milestone servono a **consegnare componenti del prodotto-obiettivo**, non a convertire Casetta in una versione semplificata indefinita. Ogni segmento crea un flusso completo, con verifica e tracciabilità. Nessuna promessa «automatico» se non è realmente implementato.

### R0 — Congelare e proteggere la base esistente

- Inventario delle funzioni in produzione, test e migrazioni; backup verificato e piano rollback.
- Congelare la roadmap «scanner → carrello obbligatorio» della v0.3; nessuna cancellazione distruttiva delle scorte esistenti.
- Design system e navigazione riallineati a Oggi/Agenda/Spesa/Archivio/Aggiungi.
- Redigere mappa dati `user/home/visibility/evidence`; definire normative privacy di base, retention e idempotenza.

### R1 — Assistente delle scadenze, davvero funzionante

- Agenda, attività, documenti collegati minimi, ricorrenze, pratiche `open/completed/snoozed`.
- Onboarding adattivo funzionante, risposta vocale o scritta, prima delega.
- **Spike notifiche** e implementazione end-to-end scelta; prova app chiusa per scadenze confermate, calendario iPhone con percorso affidabile.
- Prova di verità: caricare una scadenza verificata, ricevere i solleciti, chiudere la pratica, verificare stop e successiva ricorrenza proposta.

### R2 — Documento → memoria → azione

- Originali privati, upload iPhone, OCR, estrazioni, review, dedupe, collegamenti a bene/veicolo/utenza e registrazione di eventi.
- Ricerca nell'archivio, consultazione fonte e correzione/annullamento, backup ed esportazione.
- Prova: polizza e rinnovo, bolletta, ricevuta intervento; nessun campo inventato.

### R3 — Scontrino → spesa → economia

- Foto multipla, OCR e parser scontrino italiano, correzione assistita con alias di negozio, riepilogo obbligatorio, idempotenza.
- Acquisti, prezzi, categoria, confronti e riepilogo mensile; lista tipo Bring, gestione parziali/duplicati.
- Prova: venticinque righe, alcune illeggibili, sconto a totale, registrazione finanziaria corretta, stesso scontrino riacquisito senza doppio addebito.

### R4 — Memoria che impara e suggerisce

- Modelli statistici comprensibili, frequenze con confidenza, pause, rifiuti, temporaneità e stagionalità basilare.
- Suggerimenti contestuali solo Oggi; azioni confermate dall'utente, spiegazione «perché» e «non suggerire più».
- Prova: variazione di abitudini nel tempo, visita ospiti temporanea, rifiuti ripetuti senza notifiche inutili.

### R5 — Offerte pertinenti e perfezionamento della V1

- Pilota volantino di punto vendita reale, condizioni d'uso, verifica offerte e prezzi unitari, matching prudente, confronto con storia.
- Cura UI, voice flow, calendario, notifiche, costi, sicurezza e recupero dati; test su iPhone reale e più utenti/case.
- Prova: segnalare soltanto offerta pertinente disponibile da fonte verificata, mostrarne validità e spiegare la convenienza relativa.

**Sequenza modificabile secondo dipendenze tecniche, ma requisiti V1 non cancellabili silenziosamente.** Se il vincolo 0 €/mese impedisce una capacità chiave a qualità accettabile, aprire una decisione esplicita con prove e alternative: mai presentare un mock o una regola superficiale come intelligenza completa.

## 18. Criteri di accettazione trasversali e casi critici

1. **Onboarding:** un utente che parla di bollette e auto ottiene priorità pertinenti e una prima azione; un utente senza auto non vede schede auto inutili.
2. **Scadenze:** una polizza con data confermata attiva avvisi; «Fatto» ferma il follow-up; un documento successivo aggiorna la nuova scadenza solo con verifica.
3. **Privacy:** un convivente editor non vede documenti marcati personali di un altro account; uno spettatore non modifica nulla; revoca efficace su cache, URL e API.
4. **Scontrino:** foto 25 voci con 3 dubbie produce riepilogo 22 riconosciute + 3 da verificare; prezzi conservati, totale riconciliato o differenza esplicita, conferma unica, nessun doppione.
5. **Economia:** aggregazione importi in centesimi, distinguere mesi/fusi, rimborsi/sconti, trend comparabili; le spese non acquisite sono dichiarate sconosciute.
6. **Abitudini:** segnalazione del latte solo dopo osservazioni sufficienti; nessuna quantità residua inventata; `Non serve` abbassa/ritarda il suggerimento.
7. **Memoria:** una foto assicurazione, una ricevuta di officina e una revisione si collegano allo stesso veicolo con revisione umana per ambiguità.
8. **Voce:** microfono realmente operativo in PWA iPhone con fallback onesto; il testo riconosciuto resta correggibile prima del salvataggio.
9. **Calendario:** un evento domestico è consultabile sul calendario iPhone con limiti chiari, senza pubblicare dettagli privati.
10. **Offerte:** proposta solo con prezzo/fonte/validità e match di prodotto affidabile; nessuna notifica push per promozioni generiche.
11. **Rete:** timeout dopo «Conferma» non duplica spesa, evento, scadenza o notifiche; recupero bozza idempotente.
12. **Disponibilità:** test reale delle notifiche con PWA chiusa, anche dopo periodi di inattività; in caso di guasto rendere evidente l'impossibilità di garantire un avviso.
13. **Dati:** backup ed export recuperabili; nessun aggiornamento di una casa modifica dati di un'altra; ricerca esclusivamente nello scope autorizzato.
14. **Usabilità:** nessun consumo di olio, acqua o pasta da registrare obbligatoriamente; nessun barcode richiesto per una lista; dati estratti da foto con una conferma finale.

## 19. Metriche di qualità e anti-metriche

Monitorare con consenso e senza profilazione invasiva:

- **Lavoro eliminato:** numero medio di tocchi/campi richiesti per delegare una scadenza, acquisire uno scontrino e ritrovare un documento.
- **Accuratezza:** importi corretti, richieste di chiarimento, falsi abbinamenti, scadenze inventate (obiettivo: zero).
- **Affidabilità:** promemoria consegnati in tempo, duplicati, solleciti dopo completamento (obiettivo: zero), corretto recupero.
- **Pertinenza:** quota di suggerimenti accettati, rifiutati, rinviati e soppressi dopo feedback.
- **Fiducia:** possibilità reale di leggere fonte, correggere, esportare, revocare e capire i limiti.
- **Costo:** consumo di storage, database, CPU, rete, OCR e invocazioni rispetto alle quote gratuite.

**Non ottimizzare:** numero di interazioni con l'app, numero di scansioni, numero di notifiche inviate, quantità di dati inseriti, tempo trascorso dentro Casetta. L'assistente migliore può richiedere sempre meno aperture.

## 20. Controllo modifiche e prossimi artefatti

1. Approvare la v0.5 come **fonte primaria di prodotto**, mantenendo v0.3 come documento storico tecnico.
2. Preparare un inventario `già funzionante / da adattare / nuovo / rischio tecnico` per i moduli reali, non presunti.
3. Redigere 4 specifiche operative collegate: `R1_scadenze_e_notifiche.md`, `R2_memoria_documenti.md`, `R3_scontrini_economia.md`, `R4_apprendimento_e_offerte.md`, ciascuna con schema, permessi, state machine, UX e test su iPhone.
4. Per prima cosa verificare con prove su dispositivo due incognite che potrebbero mettere in discussione la fattibilità gratuita: **push affidabile con app chiusa e inattività**, **OCR+parsing di scontrini italiani reali**. Parallelamente impostare dominio attività/memoria; non lasciare che il primo spike determini arbitrariamente il perimetro del prodotto.
5. Nessuna migrazione distruttiva, esposizione di dati personali in repository, né deploy senza backup, migrazioni e criteri di collaudo.

---

### Nota sui riferimenti normativi e di piattaforma (23 ottobre 2026)

- Supabase Free e pausing: <https://supabase.com/pricing> · <https://supabase.com/docs/guides/platform/free-project-pausing>
- Web Push per PWA su iPhone da iOS 16.4: <https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers> · <https://webkit.org/blog/13878/>
- Possibile motore cron gratuito da valutare, non ancora scelto: <https://developers.cloudflare.com/workers/platform/limits/>

*Le quote, l'operatività e le condizioni dei servizi possono cambiare. I riferimenti esterni non sostituiscono il collaudo.*
