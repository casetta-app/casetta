# M2-B.2 — Scanner dopo conferma

## Diagnosi

Il salvataggio non chiama stop direttamente: attende il reload delle scorte e poi next(), che prima azzerava soltanto i dati e mostrava sempre «Pronto». Non verificava stream, riproduzione o disponibilità effettiva della camera. Dopo un arresto non recuperava la camera. visibilitychange/pagehide e gli errori della camera possono arrestarla; il preciso evento all'origine del caso iPhone non è riproducibile dal solo codice e resta da osservare sul dispositivo.

## Modifiche

- next() verifica camera pronta, stream con track non terminate e riproduzione. Se necessario riavvia soltanto con app visibile e sessione non sospesa. Un video funzionante resta sullo stesso elemento DOM.
- Background/pagehide sospendono esplicitamente la sessione: né la conferma né Prossimo codice la riavviano fino a Riprendi fotocamera. Callback di generazioni precedenti ignorate.
- Messaggi separati per avvio, camera attiva e camera sospesa; nessuna promessa di scansione pronta durante avvio/sospensione.
- Anteprima ridotta a 88 px dopo lettura, espandibile e nuovamente grande al prossimo codice. Nessuna modifica al contenuto dei frame o al decoder.
- Fallback di inserimento manuale nascosto per proposte OFF complete/incomplete, che hanno già conferma e modifica; conservato per assenza/indisponibilità. Inserimento manuale del codice sempre accessibile.

## Test

65 test Node passati; typecheck, lint e build passati (rimane warning chunk oltre 500 kB). Regressione UI Chromium mobile/desktop: proposta, modifica/conferma, recupero di preview arrestata, anteprima compatta/espansa, assenza fallback ridondante, sospensione pagehide e ripresa esplicita, cambio casa, ruoli e rivalidazione senza remount. Test ottici reali ZXing in Chromium sui sei campioni e cleanup superati. Camera/backend simulati nella suite UI; nessuna dichiarazione di nuovo collaudo Safari/iPhone.

Nessuna modifica a decoder, API OFF, RPC, migrazioni, permessi o dati reali. Nessun commit, push o deploy. La modifica preesistente a .gitignore non fa parte di questo intervento.
