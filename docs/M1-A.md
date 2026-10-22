# M1-A — Database scorte e inventario ibrido

## Analisi e compatibilità

Lavoro svolto nel checkout principale `/Users/gianluigitarantino/Documents/Codex/casetta`, branch `main`, inizialmente pulito, HEAD iniziale `3c720a2`. Lette integralmente le specifiche CASETTA v0.3 e il brief M0; esaminati schema M0-B.1, membership, RLS, grant, test e convenzioni esistenti. Il nome `home_members` resta quello già applicato. React/TypeScript/Vite/HashRouter, autenticazione e UI non vengono modificati.

La migrazione M0 è già applicata al progetto reale: **non è stata modificata**. La nuova migrazione è soltanto additiva: `supabase/migrations/202610220002_m1a_hybrid_inventory.sql`. Non contiene cancellazioni/aggiornamenti di righe esistenti, seed, creazione automatica di posizioni o prodotti, né nuove funzionalità Auth. Nessun collegamento al database reale, nessuna modifica a Casicali o altri dati reali.

Il catalogo separa identità e formato; le scorte appartengono sempre a una casa. Il catalogo comune è curato da un futuro backend attendibile, senza consentire ai client di pubblicare involontariamente dati domestici. Un prodotto personalizzato è privato della casa: per renderlo comune in futuro servirà una procedura esplicita, non il cambio libero di un campo dal browser.

## Schema

| Tabella nuova       | Significato e relazioni                                                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `products`          | Identità: nome, marca facoltativa, classificazione food/household/other. `scope_home_id NULL` indica catalogo comune; un ID indica prodotto privato di quella casa. `source`/`source_ref` predisposti per riferimenti esterni, nessuna integrazione implementata.                   |
| `product_formats`   | Più formati per identità: packaged/loose/piece, etichetta, barcode opzionale, dimensione e unità facoltative. FK a products. Identità, dimensioni e barcode restano immutabili: correzioni sostanziali richiederanno un nuovo formato, senza riscrivere la semantica dello storico. |
| `home_products`     | Collega una casa a un formato comune o privato della stessa casa, con alias domestico facoltativo. Unicità casa/formato. Non contiene la quantità posseduta.                                                                                                                        |
| `storage_locations` | Posizioni personalizzate della casa. Nessun record creato di default; nome modificabile, identità e casa immutabili.                                                                                                                                                                |
| `stock_entries`     | Più lotti per home_product, ciascuno con modalità, certezza, quantità/livello, unità, stato confezione, posizione/scadenza facoltative e versione. FK composite assicurano stessa casa per home_product e posizione.                                                                |
| `stock_movements`   | Registro di operazioni con autore opzionale, richiesta idempotente, tipo, snapshot prima/dopo e riferimento al lotto principale ed eventuale lotto aperto. FK composite ai lotti della stessa casa.                                                                                 |

Relazioni: prodotto → più formati; formato → home_products di più case; home_product → più lotti; lotto → più movimenti. Posizioni, collegamenti domestici, scorte e cronologia non vengono condivisi perché due case usano lo stesso formato.

Il barcode appartiene al formato commerciale. È testo e conserva gli zeri iniziali; sono ammesse lunghezze GTIN/EAN/UPC di 8/12/13/14 cifre. In M1-A non sono implementati scanner, controllo checksum, lookup o canonicalizzazione. L’unicità è per prodotto/barcode, non globale: formati privati possono riferirsi al medesimo barcode senza esporre informazioni fra case. Il futuro importatore dovrà gestire provider, deduplicazione, provenienza, condizioni d’uso e proposte correggibili; oggi non viene contattato alcun catalogo esterno.

## Modalità e certezza

`mode` descrive il tipo di informazione, `certainty` la sua attendibilità dichiarata:

| Modalità  | Rappresentazione                                        | Certezza                   |
| --------- | ------------------------------------------------------- | -------------------------- |
| `count`   | Quantità intera, unità `pack` o `piece`; nessun livello | confirmed oppure estimated |
| `measure` | Quantità decimale con g/kg/ml/l; nessun livello         | confirmed oppure estimated |
| `level`   | available/low/empty, quantità e unità NULL              | confirmed oppure estimated |
| `unknown` | Quantità, unità e livello NULL                          | soltanto unknown           |

Una riga assente significa **non censito**. Una riga unknown significa **prodotto conosciuto, disponibilità non verificata**. Uno zero numerico confirmed è una quantità verificata; zero estimated non è una conferma. Un livello empty non inventa una quantità numerica esatta. La data `last_verified_at` esiste solo per confirmed: le stime non ricevono una falsa data di verifica. Nessuna previsione o procedura automatica di stima è implementata; il modello può rappresentarne gli esiti futuri.

`inventory_quantity` è un dominio PostgreSQL `numeric` esatto: 0 ≤ quantità < 10^12, massimo sei cifre decimali dopo la rimozione degli zeri finali. Non sono usati real/double precision; riferimento: [tipi numerici PostgreSQL](https://www.postgresql.org/docs/17/datatype-numeric.html). NaN, infiniti, negativi, quantità fuori intervallo e precisione eccessiva sono rifiutati, senza arrotondamento silenzioso. Il conteggio di pezzi/pacchi è ulteriormente vincolato a numeri interi. Le unità di massa e volume non sono convertite implicitamente, né possono contraddire la dimensione nota del formato.

Gli snapshot conservano `quantity` come stringa decimale. Il futuro adapter frontend dovrà mantenere questa precisione anche in lettura e nei calcoli; non deve affidarsi indiscriminatamente a `Number` JavaScript per quantità arbitrarie. I campi numerici diretti restituiti da PostgREST richiederanno una rappresentazione/lettura decimale appropriata nel futuro adapter.

### Esempi di stato

Un formato comune «Pasta, pacco 500 g» è distinto da una scorta:

```json
{
  "mode": "count",
  "quantity": "3",
  "unit": "pack",
  "certainty": "confirmed",
  "package_state": "sealed"
}
```

Una confezione aperta della stessa pasta con contenuto quasi finito è una seconda riga:

```json
{
  "mode": "level",
  "level": "low",
  "certainty": "confirmed",
  "package_state": "open",
  "package_count": 1
}
```

`package_count` conta i contenitori osservati quando il contenuto è indicativo/misurato/sconosciuto: non è il peso residuo. Nel count il numero di contenitori è già quantity, quindi non si duplica package_count. Stato sealed/open è facoltativo (`unspecified` se non tracciato) e si applica solo ai formati confezionati. Il modello non obbliga a mantenere un inventario di tutte le confezioni.

Farina 1,5 kg o carne 750 g usano measure con unità esplicita. Detersivo aperto può usare level senza millilitri. Un prodotto senza verifica usa:

```json
{ "mode": "unknown", "certainty": "unknown" }
```

Posizione e scadenza possono restare NULL in tutti questi casi. Lotti distinti consentono, senza imporli, scadenze e posizioni differenti per lo stesso formato.

**Aggregazione futura:** non sommare pacchi e grammi, unità diverse o conferme e stime come se fossero un unico totale certo. `SUM(quantity)` ignora i NULL: da solo non dimostra il totale di un prodotto che ha anche lotti unknown/level. La futura UI dovrà mostrare separatamente quantità note, contenitori aperti e informazioni non verificate, senza tradurre l’assenza di record in zero.

## Operazioni e cronologia

La sola API di modifica delle scorte è `public.record_stock_movement(...)`. Restituisce l’UUID del movimento, poi consultabile con RLS. L’autore è sempre `auth.uid()`, mai un parametro frontend.

| Parametro                      | Uso                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `p_home_id`, `p_key`, `p_kind` | Casa, chiave UUID idempotente e tipo operazione obbligatori                                                                       |
| `p_entry_id`                   | Lotto esistente, oppure NULL per creare un lotto                                                                                  |
| `p_home_product_id`            | Richiesto solo creando un lotto; non può ricollocare un lotto esistente                                                           |
| `p_state`                      | Stato completo per nuova riga/correction; per consumo indicativo soltanto il livello finale                                       |
| `p_amount`, `p_unit`           | Importo positivo e unità attesa per incremento/decremento numerico; mai grammi interpretati come kg dopo una modifica concorrente |
| `p_location_id`                | Destinazione per move; NULL rimuove l’assegnazione                                                                                |
| `p_expected_version`           | Obbligatoria per correzioni di righe esistenti, facoltativa per altre operazioni                                                  |
| `p_note`                       | Nota privata della casa, massimo 500 caratteri                                                                                    |

`p_state` accetta soltanto mode, quantity, unit, level, certainty, package_state, package_count, location_id ed expires_on. Non accetta home_id, ruoli, ID, versioni, autore o timestamp. Le chiavi sconosciute vengono rifiutate.

| Tipo         | Comportamento                                                                                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `correction` | Crea una rilevazione senza inventare un acquisto oppure sostituisce uno stato esistente con controllo della versione. Rimane distinguibile dai consumi.                                                                                                                                                            |
| `purchase`   | Registra un apporto noto, numerico o qualitativo available. Può incrementare una quantità già confermata nella stessa unità; non trasforma un totale sconosciuto/stimato in un totale certo. In quel caso si crea un lotto separato per il nuovo apporto. È una primitiva DB, non un carrello o workflow acquisti. |
| `consume`    | Decrementa una quantità confermata senza scendere sotto zero, oppure abbassa un livello confermato available → low/empty o low → empty. Nessun consumo numerico arbitrario da unknown/estimated.                                                                                                                   |
| `open`       | Preleva pacchi interi da un lotto count/pack/sealed confermato; crea un lotto level/available/open con contenitori contati e nessun peso residuo inventato. Vecchia e nuova riga cambiano nella stessa transazione.                                                                                                |
| `move`       | Sposta l’intero lotto in una posizione della stessa casa o in nessuna posizione. Non modifica quantità, certezza o data di verifica. Gli spostamenti parziali richiederanno un’estensione dedicata.                                                                                                                |
| `discard`    | Decrementa una quantità certa oppure scarta interamente un lotto qualitativo/sconosciuto, confermando empty senza un falso numero di scarto. Il tipo rimane distinto da consume e correction.                                                                                                                      |

Ogni evento contiene snapshot prima/dopo prodotti dal database; un’apertura include entrambe le righe finali. Se il registro non può essere scritto, anche la variazione di scorta e l’eventuale nuovo lotto vengono annullati. Il registro non è un catalogo prezzi o un sistema completo di event sourcing: le scorte correnti restano in stock_entries, lo storico permette di ricostruire le modifiche e distinguerne la natura.

Il registro è append-only per le normali operazioni, incluso DML amministrativo ordinario. Le eccezioni di ciclo di vita sono intenzionali: cancellando la casa tramite M0 vengono eliminati anche i suoi dati privati; cancellando un account Auth l’autore FK viene reso NULL senza cambiare il resto dell’evento. Non si conserva nel payload un secondo campo autore che vanifichi tale anonimizzazione. Nessun client ha INSERT/UPDATE/DELETE sul registro o sulle scorte.

## Concorrenza e idempotenza

Le scritture bloccano la casa con la stessa convenzione M0, ricontrollano il ruolo dopo l’attesa e bloccano il lotto interessato. Il lock a livello casa è volutamente semplice e conserva l’ordine rispetto a revoche, trasferimenti e cancellazione casa: operazioni di case diverse non usano la stessa riga di lock. Non si eseguono chiamate esterne dentro la transazione.

La chiave è unica per casa e legata a richiesta completa e autore. Stessa richiesta/autore/chiave restituisce lo stesso evento senza nuove scritture; stesso UUID con altri dati o autore è un conflitto, non una nuova contabilizzazione. Anche i retry sono autorizzati prima di leggere l’esito: revocare un accesso impedisce di recuperare movimenti tramite la RPC. A isolamenti con snapshot ripetibili, la collisione concorrente sulla chiave viene convertita in `40001` dopo aver annullato le scritture della funzione; il retry da una nuova transazione trova l’evento originale.

Incrementi/decrementi usano i valori correnti sotto lock, non il totale calcolato dal browser. Le correzioni richiedono invece la versione letta e falliscono se è obsoleta. Una correzione in conflitto va riletta e riconciliata: non basta sostituire automaticamente expected_version e sovrascrivere con uno stato vecchio. Per altri conflitti di serializzazione si può ripetere l’intera richiesta con la medesima chiave, ricontrollando i permessi. Sotto carichi/operazioni amministrative più ampi possono verificarsi deadlock, da gestire ritentando l’intera transazione; i test non li accettano come successi.

## Sicurezza

- RLS sulle sei nuove tabelle; anon senza accesso. Owner/editor scrivono, viewer legge soltanto, estranei/revocati non leggono le informazioni domestiche.
- Catalogo comune leggibile dagli autenticati, ma non pubblicabile/modificabile da client. Formati privati ereditano la visibilità del prodotto; ogni collegamento domestico può usare soltanto formato comune o della propria casa.
- Grant per colonna sui metadati: creazione di prodotti privati, formati, posizioni, collegamenti; aggiornabili soltanto nomi/alias/classificazione o etichette. Scope, casa, formato, barcode/dimensioni e identità non vengono riassegnati liberamente. Non c’è DELETE diretto.
- FK composite e trigger impediscono riferimenti a home_product/posizione/lotto di un’altra casa. Le FK NO ACTION differibili consentono il cascade della casa senza dipendere dall’ordine dei trigger; impediscono di rimuovere un formato ancora usato da un’altra casa.
- Funzioni privilegiate con search_path vuoto, nomi qualificati e EXECUTE revocato ai client salvo la RPC pubblica. Gli helper non espongono scorciatoie per scrivere senza controllo dei ruoli. Nessuna modifica alle policy home_members o ricorsione in esse.
- Nessuna chiave service_role o servizio nuovo. Le verifiche assumono che Auth/PostgREST fornisca claim verificati; lo shim locale simula auth.uid() e non valida JWT reali.

Il catalogo globale verrà alimentato solo attraverso un processo attendibile futuro: una casa non può usarlo per divulgare automaticamente prodotti personalizzati. Gli amministratori che disabilitano trigger o usano TRUNCATE restano privilegiati per definizione e non sono utenti dell’API garantita. Un editor autorizzato può dichiarare osservazioni errate: la sicurezza controlla accessi e coerenza, non verifica fisicamente la dispensa.

## Verifiche effettivamente eseguite

Cluster PostgreSQL **17.11 (Homebrew)** temporaneo su loopback, eliminato dal runner al termine. Nessun URL Supabase o credenziale remota letti dal runner.

| Verifica                                                                                                    | Esito                                                                            |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Applicazione M1 a fixture M0 già esistenti e confronto esatto di users/profiles/homes/membership prima/dopo | PASS                                                                             |
| Assenza di seed catalogo/posizioni/scorte dopo migrazione                                                   | PASS                                                                             |
| `tests/database.sql` e `tests/lifecycle.sql`                                                                | PASS, 86 controlli SQL M0                                                        |
| `tests/inventory.sql`                                                                                       | PASS, 91 controlli SQL inventario                                                |
| Concorrenza M0                                                                                              | PASS, 24 scenari                                                                 |
| `tests/inventory_concurrency.py`                                                                            | PASS, 24 scenari: 8 corse × 3 livelli di isolamento                              |
| `pnpm test`                                                                                                 | PASS, 37 test frontend di regressione                                            |
| `pnpm typecheck`                                                                                            | PASS                                                                             |
| `pnpm lint`                                                                                                 | PASS                                                                             |
| `pnpm build`                                                                                                | PASS; avviso preesistente non bloccante per bundle di circa 509 kB / 150 kB gzip |

Le prove inventario eseguono SQL reale: prodotto comune con quantità diverse in due case, RLS su dati e cataloghi privati, ruoli, revoca, numerici/qualitativi/sconosciuti/stimati, zero confermato e stimato, 750 g e quantità frazionarie, tre pacchi chiusi e uno aperto, scarto e consumo indicativo, correzione distinta, snapshot decimali, idempotenza e payload/autore diversi, posizione facoltativa, FK e scope, unità, NaN/Infinity/precisione, campi arbitrari, rollback se fallisce lo storico, append-only, cancellazione account/casa e conservazione della casa indipendente. Le verifiche del catalogo interrogano RLS/grant del motore, non soltanto stringhe del sorgente.

Le otto corse sono: otto consumi con una chiave; creazione dello stesso lotto con una chiave; due consumi dell’ultima confezione; incrementi decimali concorrenti; correzioni obsolete; apertura contro consumo; revoca contro movimento; eliminazione casa contro movimento. Ciascuna gira a READ COMMITTED, REPEATABLE READ, SERIALIZABLE, con una barriera che conferma l’acquisizione degli snapshot prima di liberare le connessioni. Si verificano codici SQLSTATE attesi, assenza di quantità negative e di riferimenti orfani. Per i conflitti serializzabili il test esegue retry espliciti da nuove transazioni, poi ricontrolla quantità e numero di eventi.

La revisione statica di vincoli, percorso dei lock, grant e architettura è distinta dalle prove PostgreSQL sopra. Non sono stati eseguiti test sul Supabase reale, un nuovo test mobile, scanner, API barcode, carrello o UI M1-B. Le verifiche Mac/iPhone e la presenza della casa reale sono lo stato comunicato dall’utente, non nuove prove di questo incarico.

Comandi:

```sh
pnpm test:db
# Per ogni messaggio delle singole asserzioni:
python3 tests/run-database.py --verbose
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Applicazione futura dopo revisione

La migrazione è preparata, **non applicata al remoto**. Dopo revisione/backup del solo progetto Casetta, applicare integralmente soltanto `202610220002_m1a_hybrid_inventory.sql`, inclusi BEGIN/COMMIT. Non rieseguire M0 e non eseguire i file tests sul progetto reale. Con CLI, verificare project ref e piano delle migrazioni prima di qualsiasi applicazione; questo incarico non effettua collegamenti o push database.

La creazione di FK richiede normali lock DDL brevi anche sulle tabelle referenziate. Se l’app è in uso, pianificare l’applicazione e verificare timeout/permessi del ruolo di migrazione. Un errore annulla la migrazione. Dopo aver scritto scorte reali, usare una migrazione correttiva o un ripristino revisionato, non cancellare tabelle per ripartire.

## Predisposizione futura e limiti

- Scanner e API esterne possono trovare un formato per barcode e collegarlo tramite home_products; nessuna richiesta esterna è implementata.
- Il carrello futuro potrà invocare queste primitive in un’unica transazione con una chiave per riga e un’idempotenza di sessione, da progettare in M2. La M1-A non implementa carrelli o acquisti UI.
- Soglie, lista automatica e preferenze di consumo saranno per home_product, con unità e certezza esplicite; oggi non esistono tabelle o automatismi inutilizzati per queste funzioni.
- Scadenze e lotti sono già rappresentabili senza obbligarli. Ricette/ingredienti potranno riferirsi all’identità prodotto senza leggere scorte private di altre case. Prezzi e previsioni richiederanno estensioni dedicate, provenienza e controlli di qualità.
- La cancellazione della casa elimina lo storico domestico; eventuale archiviazione/retention richiederà una decisione di prodotto futura. Non è un log legale immutabile fuori dal ciclo di vita della casa.
- Spostamenti parziali, conversioni automatiche di unità, equivalenze fra formati e riformulazioni di prodotti in uso non sono implementati. La UI dovrà usare snapshot decimali e non presentare somme di valori sconosciuti/stimati come quantità confermate.
- La validazione del servizio Supabase completo (Auth/PostgREST, ruoli e impostazioni effettive del progetto) resta da eseguire dopo revisione e applicazione autorizzata. Le prove locali non la sostituiscono.

## File

Creati: migrazione `supabase/migrations/202610220002_m1a_hybrid_inventory.sql`, `tests/inventory.sql`, `tests/inventory_concurrency.py`, `docs/M1-A.md`.

Modificati: `tests/run-database.py` (upgrade con dati preesistenti e nuove suite), `tests/concurrency.py` (barriera condivisa, regressioni M0 conservate), `README.md`.

Migrazione M0, autenticazione, componenti UI, configurazione Pages/PWA e dipendenze invariate. Nessun commit, push, deploy, progetto/servizio aggiuntivo o dato dimostrativo persistente. Fine M1-A.

## Stato successivo comunicato

In M1-B l’utente ha indicato che la migrazione M1-A è stata poi applicata al progetto Supabase Casetta. Il presente incarico non l’ha verificata né modificata sul remoto; la nuova UI è stata costruita sul contratto documentato qui. Vedi [M1-B](M1-B.md) per verifiche e limiti della pagina Scorte.
