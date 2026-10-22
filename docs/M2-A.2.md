# M2-A.2 — Scanner e prove ottiche

## Difetti accertati e ipotesi

Il vecchio selettore nativo richiedeva EAN-8/EAN-13/UPC-A/ITF tutti insieme: un browser con EAN/UPC nativi ma senza ITF veniva escluso. Il feedback era sotto anteprima, comandi e modulo manuale dentro il form Aggiungi: poteva essere fuori viewport. Il lock impediva nuovi lookup, ma il decoder continuava comunque a elaborare frame durante la decisione. I test precedenti sostituivano il decoder e non dimostravano la lettura di immagini. La decodifica delegata a reader.scan aveva controlli meno espliciti su attesa dei frame, dimensioni e avanzamento/fallimento del ciclo. Non è stato dimostrato un errore specifico del vecchio ZXing.scan su Safari: l'esatto motivo del mancato riconoscimento sul dispositivo rimane da verificare.

Confermata la validità di EAN-13 9771125522005; checksum invariato, nessuna eccezione per il campione. Preview precedente con proporzioni diverse dal video produceva letterboxing (object-fit contain), non una prova di distorsione dei frame decodificati. Fuoco, obiettivo selezionato da iOS, luce, distanza e riflessi restano ipotesi hardware/ambientali.

Confrontati in sola lettura MaterialBarcodeScanner.tsx e barcodeCamera.ts di lulabworks/lulab-desk (main). Si conservano getUserMedia environment, srcObject/play espliciti, video inline, annullamento sincrono e finestra dedicata. Casetta mantiene la sessione e ITF-14, anziché fermarsi al primo codice come LuLab. Nessuna modifica a LuLab.

## Decodifica e ciclo di vita

Il nativo usa l'intersezione dei formati disponibili: EAN/UPC non sono esclusi per assenza di ITF. Se non trova risultati, non è disponibile o fallisce, ZXing legge lo stesso frame per tutti i quattro formati. Un solo ciclo asincrono serializzato: niente loop sovrapposti. Risultati nativi multipli nello stesso frame sono ignorati. ITF viene limitato a 14 cifre, con checksum applicativo invariato.

Nuovo decoder.ts condiviso dai frame live e dai test browser: BrowserMultiFormatReader con formati espliciti e TRY_HARDER. NotFound/Checksum/Format sono normali tentativi senza risultato; gli errori inattesi arrivano al chiamante e fermano stream/ciclo, con messaggio e possibilità di riprendere. Timeout per API native, video.play, caricamento decoder e assenza di frame; gli import possono terminare dopo lo stop ma non riavviano la camera. Canvas dimensionato sui pixel intrinseci videoWidth/videoHeight, non su CSS o crop. Richiesta 1280×720 ideale e environment; focus continuo richiesto solo se dichiarato nelle capabilities, senza bloccare hardware che lo rifiuta. Non si garantisce autofocus su ogni iPhone.

Durante un risultato il ciclo sospende le letture tramite isPaused, mantenendo lo stream. Conferma o Prossimo codice sbloccano la sessione; debounce e codici già letti restano attivi. Cleanup su chiusura, cambio pagina/casa, revoca o background; ripresa esplicita dopo background. Nessuna modifica delle scorte senza conferma.

## UI

Dialog nativo modale in portal su document.body: focus contenuto, Escape/Chiudi accessibili, sfondo inerte. Intestazione sticky con un solo titolo, Chiudi e codice/stato riconosciuto visibili immediatamente prima del lookup. Video largo con proporzioni preservate e guida discreta. Manuale e ripetizione volontaria in una sezione secondaria. Rimosso il pulsante Arresta permanente. Stati trovato, assente, ambiguo ed errore distinti; una ricerca fallita offre Riprova e non abilita l'inserimento di un presunto prodotto sconosciuto. Errori di conferma e di camera sono mostrati esplicitamente.

## Prove

Campioni e generatore indipendente dalle librerie in tests/fixtures/barcodes (vedi README). Sei campioni: quattro validi EAN13/EAN8/UPC-A/ITF14, blank e checksum EAN errato. Test Node ZXing reali più browser Chromium con SVG effettivamente caricati/rasterizzati e decoder.ts di produzione. Integrazione camera con canvas.captureStream e decoder reale: EAN13 segnalato, ITF14 con nativo parziale EAN/UPC, ITF14 dopo errore nativo; cleanup verificato. Errore inatteso di elaborazione frame iniettato: messaggio di fallimento e tracce arrestate. Questi test non sostituiscono il collaudo di una camera fisica.

Regressione browser separata con backend/camera/decoder simulati: permessi negati, lookup lento con codice già visibile a 320×568 e 390×844, decoder sospeso durante decisione, ambiguità/duplicati, errore rete distinto da assenza, navigazione/cambio casa, downgrade/revoca/errori permessi, DOM stabile durante refresh, viewer e flussi M1. La correzione HomeProvider/HomeGate della M2-A.1 non è stata modificata.

Da verificare su Safari/PWA iPhone reale: fotocamera fisica selezionata, fuoco sui quattro formati stampati, distanza e riflessi, tempi di riconoscimento, primo permesso, chiusure rapide e richieste pendenti, blocco schermo/ripresa, focus e tastiera del dialog, rotazione e safe area. Non è dichiarato alcun nuovo collaudo Safari. Nessun database remoto, dato reale, migrazione, commit, push o deploy.
