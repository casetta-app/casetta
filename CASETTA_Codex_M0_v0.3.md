# CASETTA — Brief operativo per Codex, milestone M0 (v0.3)

**Attenzione:** questo brief descrive l’intera M0. Per il primo incarico M0-A (solo setup locale), non serve ancora creare il repository remoto o il progetto Supabase. Non toccare LuLab Desk, JanSession o i rispettivi database.

**Nome definitivo del progetto:** Casetta (`casetta` come cartella e repository).

## Obiettivo
Impostare le fondamenta tecniche della nuova PWA Casetta, senza implementare ancora scanner, acquisti o inventario.

## Contesto
Leggi integralmente `CASETTA_specifica_v0.3.md`. La piattaforma gestisce account personali e abitazioni indipendenti, con autorizzazioni di lettura/modifica anche unidirezionali. Le operazioni riguardano sempre una `home_id`.

## Consegne M0
1. Inizializza un nuovo progetto TypeScript mobile-first con PWA e routing di base. Prima di scegliere il framework, valuta compatibilità iOS, complessità e semplicità manutentiva; spiega la scelta brevemente.
2. Predisponi configurazione ambienti, lint, controlli TypeScript, formato, README e istruzioni locali.
3. Integra Supabase Auth senza credenziali o chiavi privilegiate nel repository.
4. Crea migrazioni SQL per `profiles`, `homes`, `home_access`, `home_invitations`, con vincoli, indici e timestamp sensati.
5. Implementa RLS e grant minimi, testando ruoli owner/editor/viewer e negazione cross-home. Prevenire escalation di ruolo e revoche non autorizzate.
6. Implementa il primo avvio descritto nelle sezioni 17-22 della specifica: autenticazione, account senza case, creazione casa tramite solo nome, owner assegnato atomicamente, scelta e recupero casa attiva. La scelta del metodo Auth va validata e documentata (in particolare link/codici email su iPhone).
7. Navigazione mobile vuota: Oggi / Scorte / Spesa / Gestione. Su Oggi mostra lo stato vuoto autentico, non inventare scorte o attività; per funzioni non sviluppate mostra un'etichetta chiara o disabilita l'azione. Non chiedere la fotocamera in onboarding.
8. Predisponi il modello inviti/accessi, ma realizza l'intero flusso inviti soltanto se sicuro e testabile nella M0; altrimenti lascia il percorso «Accetta invito» non disponibile e pianificato per M4. Il futuro destinatario invitato non dovrà essere obbligato a possedere una casa.
9. Gestisci ritorno dopo refresh/login, account senza case, nome casa duplicato, rete incerta (anti-doppia-creazione), revoca di accesso, accesso osservatore e cambio casa, con feedback leggibili.
10. Test automatici: creazione atomica home+owner; nessuna elevazione di ruolo; nessun accesso cross-home; ritorno sulla casa autorizzata; assenza di falsi zeri; refresh di sessione e eventuale idempotenza.
11. Non simulare il funzionamento di funzioni ancora assenti e non creare dati inventati persistenti.

## Regole
- Nuovo repository e nuovo Supabase: completamente separati da ogni progetto LuLab.
- Mai usare la service-role key nel browser.
- Ogni tabella esposta deve avere RLS e permessi controllati.
- Non utilizzare query client che bypassano il controllo dei ruoli; accessi verificati dal database.
- Niente integrazioni terze nella M0.
- Fai migrazioni piccole e riproducibili, con rollback o procedure di ripristino documentate.
- Fermati prima di qualsiasi deploy o push remoto non esplicitamente autorizzato.

## Output richiesto da Codex
- Codice implementato localmente e elenco file creati/modificati.
- Istruzioni precise per avvio/test.
- Esiti dei test, evidenza delle policy RLS e limitazioni residue.
- Proposta per la successiva milestone M1, senza avviarla.


## Specifica di interfaccia per il primo accesso (v0.3)
- Percorso dopo login: `nessuna casa` → `crea casa` (solo nome, valore iniziale «Casetta mia») → `home vuota`.
- In futuro: `link invito` → login → dettaglio invito e permesso → accetta/rifiuta → home invitante, senza creare una casa propria.
- Se case già esistono: vai all'ultima casa ancora autorizzata; altrimenti al selettore/creazione.
- Header persistente con nome casa attiva e selettore; non cambiare `home_id` di una bozza esistente.
- Nessun indirizzo fisico, metri quadri, lista stanze o inventario obbligatorio.
- Home vuota: «La tua casa è pronta. Non serve inserire tutto quello che possiedi: iniziamo dai prossimi acquisti.»; ma non mostrare come operative funzioni che arriveranno nelle milestone M1-M3.
- Preferenza tecnica: evitare letture di cache dopo revoca; rieseguire controlli di accesso con il DB in ogni query.
- Prima di dichiarare M0 conclusa, provarla su un iPhone reale con Safari e in PWA installata, per quanto possibile nell'ambiente disponibile. Se non eseguibile, segnare il test come NON ESEGUITO.
