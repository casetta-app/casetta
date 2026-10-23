import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useHomes } from '../homes/HomeContext'
import {
  executeTask,
  loadTasks,
  pendingKey,
  persistCommand,
  restoreCommand,
  taskError,
  type TaskCommand,
} from './api'
import {
  formatTaskInstant,
  isClosed,
  relevantTasks,
  stateLabels,
  taskDate,
  type Task,
} from './model'

export function TasksPage({ today = false }: { today?: boolean }) {
  const { session } = useAuth()
  const { activeHome } = useHomes()
  return (
    <TaskWorkspace
      key={`${session!.user.id}:${activeHome?.id}:${activeHome?.access.role}`}
      user={session!.user.id}
      home={activeHome?.id ?? null}
      writable={activeHome?.access.role !== 'viewer'}
      today={today}
    />
  )
}
function TaskWorkspace({
  user,
  home,
  writable,
  today,
}: {
  user: string
  home: string | null
  writable: boolean
  today: boolean
}) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<TaskCommand | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const alive = useRef(false)
  const sequence = useRef(0)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [zone, setZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome',
  )
  const [scope, setScope] = useState('personal')
  const [kind, setKind] = useState('chore')
  const [importance, setImportance] = useState('2')
  const [recurrence, setRecurrence] = useState('none')
  const [count, setCount] = useState('1')
  const [unit, setUnit] = useState('month')
  const [showClosed, setShowClosed] = useState(false)
  const [snoozing, setSnoozing] = useState<string | null>(null)
  const [until, setUntil] = useState('')
  const queueKey = pendingKey(user, home)
  const refresh = useCallback(async () => {
    const request = ++sequence.current
    try {
      const data = await loadTasks(user, home)
      if (!alive.current || request !== sequence.current) return
      setTasks(data)
      setError('')
    } catch (e) {
      if (!alive.current || request !== sequence.current) return
      setTasks([])
      setError(taskError(e))
    } finally {
      if (alive.current && request === sequence.current) setLoading(false)
    }
  }, [user, home])
  useEffect(() => {
    alive.current = true
    const requestSequence = sequence
    try {
      setPending(restoreCommand(queueKey))
    } catch (e) {
      setError(taskError(e))
    }
    void refresh()
    const check = () => {
      if (!document.hidden) void refresh()
    }
    const timer = window.setInterval(check, 30000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('online', check)
    return () => {
      alive.current = false
      ++requestSequence.current
      clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('online', check)
    }
  }, [refresh, queueKey])
  async function submit(command: TaskCommand) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setNotice('')
    setError('')
    try {
      persistCommand(queueKey, command)
      setPending(command)
      await executeTask(command)
      localStorage.removeItem(queueKey)
      if (!alive.current) return
      setPending(null)
      setShowForm(false)
      setTitle('')
      setSnoozing(null)
      setNotice('Operazione registrata. Gli avvisi esterni non sono attivi.')
      await refresh()
    } catch (e) {
      if (alive.current) setError(taskError(e))
    } finally {
      inFlight.current = false
      if (alive.current) setBusy(false)
    }
  }
  function action(
    t: Task,
    operation: string,
    untilValue: string | null = null,
  ) {
    void submit({
      key: crypto.randomUUID(),
      rpc: 'act_on_domestic_task',
      args: {
        p_task: t.id,
        p_version: t.version,
        p_action: operation,
        p_until: untilValue,
      },
    })
  }
  const ordered = relevantTasks(tasks)
  const visible =
    showClosed && !today ? [...ordered, ...tasks.filter(isClosed)] : ordered
  return (
    <section className="page task-page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">IL TUO ASSISTENTE DOMESTICO</p>
          <h1>{today ? 'Oggi' : 'Agenda'}</h1>
          <p>Le cose da seguire, personali e della casa selezionata.</p>
        </div>
      </div>
      <button
        className="primary-button"
        onClick={() => setShowForm(!showForm)}
        disabled={Boolean(pending)}
      >
        {showForm ? 'Chiudi inserimento' : 'Aggiungi attività o scadenza'}
      </button>
      <p className="task-disclosure">
        Avvisi esterni non attivi: R1-A mostra le incombenze nell’app. Non
        affidarti a Casetta per ricevere notifiche a PWA chiusa.
      </p>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {pending && (
        <div className="task-card">
          <p>
            Richiesta conservata su questo dispositivo. In caso di risposta
            persa, il retry usa la stessa chiave e non duplica l’operazione.
          </p>
          <button disabled={busy} onClick={() => void submit(pending)}>
            Riprova richiesta
          </button>
          <button
            disabled={busy}
            onClick={() => {
              localStorage.removeItem(queueKey)
              setPending(null)
              void refresh()
            }}
          >
            Rileggi stato e abbandona il retry
          </button>
          <p>
            Abbandonare il retry non annulla un’operazione già ricevuta dal
            server.
          </p>
        </div>
      )}
      {showForm && (
        <form
          className="task-card"
          onSubmit={(e) => {
            e.preventDefault()
            void submit({
              key: crypto.randomUUID(),
              rpc: 'create_domestic_task',
              args: {
                p_home: scope === 'home' ? home : null,
                p_title: title,
                p_due: date ? `${date}T${time}:00` : null,
                p_timezone: zone,
                p_kind: kind,
                p_importance: Number(importance),
                p_recurrence: recurrence,
                p_count: Number(count),
                p_unit: unit,
              },
            })
          }}
        >
          <fieldset disabled={busy || Boolean(pending)}>
            <legend>Una cosa in meno da ricordare</legend>
            <label>
              Cosa devi fare?
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Es. prenotare il controllo caldaia"
              />
            </label>
            <label>
              Visibilità
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="personal">Solo io — personale</option>
                {home && writable && (
                  <option value="home">Condivisa con questa casa</option>
                )}
              </select>
            </label>
            <label>
              Data facoltativa
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Importanza
              <select
                value={importance}
                onChange={(e) => setImportance(e.target.value)}
              >
                <option value="1">Ordinaria</option>
                <option value="2">Importante</option>
                <option value="3">Prioritaria</option>
              </select>
            </label>
            <details>
              <summary>Orario, tipo e ricorrenza</summary>
              <label>
                Ora locale
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>
              <label>
                Fuso orario
                <input
                  required
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                />
              </label>
              <p>
                Ora iniziale 09:00, modificabile. Nell’ora ripetuta autunnale si
                usa l’ora standard; le ore inesistenti primaverili vengono
                rifiutate.
              </p>
              <label>
                Tipo
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {Object.entries({
                    chore: 'Attività',
                    deadline: 'Scadenza confermata',
                    appointment: 'Appuntamento',
                    maintenance: 'Manutenzione',
                    payment: 'Pagamento',
                    follow_up: 'Questione da seguire',
                  }).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ricorrenza
                <select
                  value={recurrence}
                  onChange={(e) => setRecurrence(e.target.value)}
                >
                  <option value="none">Nessuna</option>
                  <option value="calendar">
                    Intervallo di calendario dalla data iniziale
                  </option>
                  <option value="after_completion">
                    Intervallo dopo il completamento
                  </option>
                  <option value="confirmed_date">
                    Data certa: attendi una nuova conferma/documento
                  </option>
                </select>
              </label>
              {['calendar', 'after_completion'].includes(recurrence) && (
                <>
                  <label>
                    Ogni
                    <input
                      type="number"
                      min="1"
                      max="120"
                      required
                      value={count}
                      onChange={(e) => setCount(e.target.value)}
                    />
                  </label>
                  <label>
                    Unità
                    <select
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                    >
                      <option value="day">giorni</option>
                      <option value="week">settimane</option>
                      <option value="month">mesi</option>
                      <option value="year">anni</option>
                    </select>
                  </label>
                  <p>
                    La prossima occorrenza sarà da verificare. Nessuna scadenza
                    legale viene dedotta.
                  </p>
                </>
              )}
            </details>
            <button
              disabled={!title.trim() || (recurrence !== 'none' && !date)}
            >
              Registra attività
            </button>
          </fieldset>
        </form>
      )}
      <div className="task-toolbar">
        {!today && (
          <label>
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
            />
            Mostra anche concluse
          </label>
        )}
        <button disabled={busy} onClick={() => void refresh()}>
          Aggiorna
        </button>
      </div>
      {loading && <p role="status">Caricamento attività…</p>}
      {!loading && !error && !visible.length && (
        <p>
          Nessuna incombenza da mostrare. Puoi registrare la prima, anche senza
          prodotti o abitazioni.
        </p>
      )}
      {visible.map((t) => {
        const canWrite = Boolean(t.owner_user_id) || writable
        return (
          <article className="task-card" key={t.id}>
            <span className="soft-label">
              {t.owner_user_id ? 'PERSONALE' : 'CASA'} ·{' '}
              {['', 'Ordinaria', 'Importante', 'Prioritaria'][t.importance]}
            </span>
            <h2>{t.title}</h2>
            <p>
              {taskDate(t)} · {t.timezone}
            </p>
            <p>
              {stateLabels[t.state]}
              {t.due_at && !isClosed(t) && Date.parse(t.due_at) < Date.now()
                ? ' · Data originaria superata'
                : ''}
            </p>
            {t.snoozed_until && (
              <p>
                Da riprendere: {formatTaskInstant(t.snoozed_until, t.timezone)}
              </p>
            )}
            <p>
              Fonte:{' '}
              {t.source === 'user_declared'
                ? 'dichiarata dall’utente'
                : 'regola ricorrente, data da verificare'}
            </p>
            {canWrite && !isClosed(t) && (
              <div className="task-actions">
                {t.state === 'needs_verification' ? (
                  <button
                    disabled={busy || Boolean(pending)}
                    onClick={() => action(t, 'confirm')}
                  >
                    Conferma questa data
                  </button>
                ) : (
                  <>
                    <button
                      disabled={busy || Boolean(pending)}
                      onClick={() => action(t, 'complete')}
                    >
                      Fatto
                    </button>
                    <button
                      disabled={busy || Boolean(pending)}
                      onClick={() => setSnoozing(t.id)}
                    >
                      Rinvia
                    </button>
                    {t.state !== 'in_progress' && (
                      <button
                        disabled={busy || Boolean(pending)}
                        onClick={() => action(t, 'start')}
                      >
                        Inizia
                      </button>
                    )}
                  </>
                )}
                <button
                  disabled={busy || Boolean(pending)}
                  onClick={() => action(t, 'cancel')}
                >
                  Annulla attività
                </button>
              </div>
            )}
            {snoozing === t.id && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  action(t, 'snooze', until)
                }}
              >
                <label>
                  Riprendi il ({t.timezone})
                  <input
                    type="datetime-local"
                    required
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                  />
                </label>
                <button disabled={busy || Boolean(pending)}>
                  Conferma rinvio
                </button>
                <button type="button" onClick={() => setSnoozing(null)}>
                  Chiudi rinvio
                </button>
              </form>
            )}
          </article>
        )
      })}
      <div className="task-links">
        <Link to={today ? '/agenda' : '/oggi'}>
          {today ? 'Apri Agenda' : 'Vai a Oggi'}
        </Link>
        <Link to="/scorte">Apri le scorte</Link>
        <Link to="/gestione">Casa e preferenze</Link>
      </div>
    </section>
  )
}
