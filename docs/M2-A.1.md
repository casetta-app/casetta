# M2-A.1 — Rivalidazioni e fotocamera iOS

## Lampeggio: causa accertata nel codice

HomeProvider portava loading a true all'inizio di ogni refresh: intervallo di 30 secondi, focus, online e ritorno visibile. Anche l'evento hidden impostava loading. HomeGate aggiungeva uno stato di caricamento e applicava hidden al contenitore principale: questo nascondeva tutta la pagina anche con risposta identica. Il vecchio hidden non smontava da solo i figli; il difetto accertato è la sparizione visiva periodica.

Ora loading rappresenta il primo caricamento. Le rivalidazioni proseguono con lo stesso intervallo e gli stessi eventi, conservando la UI autorizzata mentre la richiesta è pendente. La risposta aggiorna casa e ruolo. Su errore di rete si eliminano homes/activeId e il gate rimuove i figli, mantenendo un messaggio e Riprova fino a una verifica riuscita. Una revoca rimuove subito la vecchia schermata quando viene ricevuta; casa/ruolo diversi cambiano la chiave del contenitore, eliminando anche editor o scanner precedenti. Risposte superate sono ignorate tramite sequence. Le normali risposte identiche non cambiano la chiave.

La revoca remota è sempre applicata da RLS alle query; la UI la rileva alla successiva verifica (30 secondi in primo piano o focus/online/visibility), senza aggiungere realtime. Un controllo ancora pendente non viene interpretato come revoca. Una verifica fallita non lascia visibili dati precedenti.

L'esame di public/sw.js e src/main.tsx non ha trovato location.reload né reload su controllerchange: il service worker esegue solo skipWaiting/clients.claim. AuthProvider non riporta loading a true durante i rinnovi token; ProtectedApp identifica HomeProvider tramite user.id, quindi un rinnovo per lo stesso account non lo rimonta. Non sono emerse altre cause programmate di ricaricamento; Safari reale può avere propri ripristini di pagina.

## Confronto con LuLab Desk

Consultati in sola lettura:

- https://github.com/lulabworks/lulab-desk/blob/main/src/components/MaterialBarcodeScanner.tsx
- https://github.com/lulabworks/lulab-desk/blob/main/src/lib/barcodeCamera.ts

LuLab avvia la camera al mount, restituisce subito una funzione di annullamento, imposta srcObject e attende video.play prima del decoder; rileva il supporto nativo completo e ripiega su reader.scan di ZXing. Casetta adotta queste strategie in src/scanner/camera.ts, inclusi stream tardivi e cleanup di timer/decoder/tracce/video. Il pannello montato dal tocco Scansiona avvia automaticamente la camera: il comando Riprendi rimane per errori o sospensione esplicita/background.

Differenze deliberate: LuLab ferma la camera al primo risultato e cerca un singolo materiale; Casetta mantiene lo stream durante lookup/conferma e consente letture consecutive. Supporta EAN-8/EAN-13/UPC-A/ITF-14, senza aggiungere UPC-E o Code128. Il nativo viene scelto solo se supporta tutti i quattro formati (itf limitato a 14 cifre); altrimenti o dopo un errore native-detect usa ZXing con gli stessi formati. Conserva checksum e zeri iniziali. Il nativo ignora frame con più risultati anziché scegliere arbitrariamente.

Debounce temporale 1200 ms per lo stesso codice e insieme dei codici già letti nella sessione; lookup serializzato tramite lock. Conferma riuscita prepara direttamente la prossima lettura, senza richiedere Prossimo codice. Per saltare un risultato non confermato rimane il comando Prossimo codice. Ripetere volontariamente un codice già letto richiede il comando dedicato. Lettura e lookup non scrivono; la conferma riusa attachCatalogFormat/RPC atomica. Errori di lookup non diventano assenze dal catalogo. Background arresta la camera e richiede Riprendi, senza una nuova richiesta automatica al ritorno.

## Verifiche e limiti

53 test Node superati, compresi annullamento prima della concessione del permesso, permesso negato/camera occupata, video inline e decoder nativo simulato con cleanup idempotente; test precedenti di barcode, auth, adapter e selezione casa. Browser Chromium con backend/video/ZXing simulati: avvio dal solo Scansiona, lookup assente e ambiguo, conferma, duplicati, pagehide e cambio casa; richiesta periodica pendente mantiene pagina DOM e camera; ruolo viewer, revoca selettiva/totale, errore rete e recupero. Regressione M1 e layout mobile/desktop inclusi. Typecheck/lint/build eseguiti; suite PostgreSQL su cluster temporaneo locale. Nessuna verifica usa Casicali o database remoto.

Resta necessaria prova su Safari e PWA installata: concessione reale del permesso dal pannello, riproduzione inline e autofocus, stampa fisica EAN/UPC/ITF-14, blocco schermo/background, ripresa, aperture rapide e navigazione. I mock non misurano qualità o velocità della decodifica ottica e non certificano che iOS conceda la camera su ogni versione. Il warning Vite del bundle principale oltre 500 kB resta presente.
