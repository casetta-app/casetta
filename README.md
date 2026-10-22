# Casetta

Fondamenta frontend della PWA Casetta (milestone M0-A). Il progetto prepara la shell responsive, i percorsi principali e l'installazione PWA; non include autenticazione, backend o dati domestici.

## Scelta tecnica

Vite + React + TypeScript strict offre avvio rapido, componenti riusabili e output statico semplice da pubblicare su GitHub Pages. Il routing usa `HashRouter`: i percorsi restano nella parte hash dell'URL, così GitHub Pages serve sempre `index.html` anche dopo un refresh. La build è configurata alla base `/casetta/`.

Per Safari su iPhone la UI usa layout mobile-first, aree sicure (`safe-area-inset-*`), link e controlli accessibili, manifest e icona touch provvisoria. Le verifiche su un iPhone reale e l'installazione dalla schermata Home restano da eseguire.

## Requisiti

- Node.js 20.19+ oppure 22.12+
- pnpm 10+

## Avvio locale

```sh
pnpm install
pnpm dev
```

Vite stampa l'indirizzo locale, normalmente `http://localhost:5173`. Per verificare l'output statico:

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm preview
```

La build usa il prefisso `/casetta/`; per la preview locale apri l'URL `/casetta/` mostrato da Vite. Nessuna credenziale è necessaria.

## Struttura

- `src/shell`: layout condiviso e navigazione
- `src/pages`: viste iniziali
- `src/components`: componenti UI riutilizzabili
- `src/domain`: tipi frontend per abitazioni e ruoli
- `public`: manifest, icone e service worker minimo

Le abitazioni, l'identità e i ruoli sono modellati come concetti separati. Gli adapter per autenticazione e dati remoti potranno essere aggiunti quando inizierà M0-B; questa milestone non si collega a Supabase.

## Configurazione

`.env.example` documenta i nomi client previsti per una fase futura. Non aggiungere mai chiavi `service_role` alle variabili frontend. `.env` è escluso da Git.

## GitHub Pages

`vite.config.ts` imposta `base: '/casetta/'`; manifest, icone e service worker usano lo stesso percorso. Pubblicare la cartella `dist` sul progetto Pages del repository `casetta` quando il deploy sarà autorizzato. Il routing hash non richiede rewrite lato server.

## Ambito M0-A

Le quattro aree sono navigabili. Oggi mostra uno stato vuoto, mentre le altre sezioni segnalano che sono in preparazione. Non sono presenti login fittizio, case di esempio, inventario, scanner, spesa o persistenza applicativa.
