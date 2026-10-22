import { useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'
import { storage } from '../lib/storage'
import { useHomes } from './HomeContext'
import { preferenceKey } from './selection'

type PendingCreation = { key: string; name: string }
export function CreateHomeForm() {
  const { session } = useAuth()
  const { refresh } = useHomes()
  const userId = session!.user.id
  const pendingKey = `casetta:${userId}:pending-home`
  const [pending, setPending] = useState<PendingCreation | null>(() => {
    try {
      const saved = JSON.parse(
        storage.get(pendingKey) ?? 'null',
      ) as PendingCreation | null
      return saved &&
        typeof saved.name === 'string' &&
        /^[0-9a-f-]{36}$/i.test(saved.key)
        ? saved
        : null
    } catch {
      return null
    }
  })
  const [name, setName] = useState(pending?.name ?? 'Casetta mia')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  async function create(event: FormEvent) {
    event.preventDefault()
    if (lock.current || !name.trim()) return
    lock.current = true
    setBusy(true)
    setError('')
    const attempt = pending ?? { key: crypto.randomUUID(), name: name.trim() }
    setPending(attempt)
    storage.set(pendingKey, JSON.stringify(attempt))
    try {
      const { data, error } = await supabase!.rpc('create_home', {
        home_name: attempt.name,
        creation_key: attempt.key,
      })
      if (error || typeof data !== 'string') throw error
      storage.remove(pendingKey)
      storage.set(preferenceKey(userId), data)
      setPending(null)
      await refresh(data)
    } catch {
      setError(
        'Creazione non confermata. Riprova: la stessa richiesta recupera la casa senza duplicarla. Puoi anche verificare l’elenco delle case.',
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <div className="management-card">
      <h2>Crea una casa</h2>
      <p>
        È sufficiente un nome. La casa avrà dati indipendenti e tu sarai il
        primo proprietario.
      </p>
      <form onSubmit={create}>
        <label>
          Nome della casa
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy || Boolean(pending)}
          />
        </label>
        <button className="primary-button" disabled={busy || !name.trim()}>
          {busy
            ? 'Creazione…'
            : pending
              ? 'Riprova la stessa creazione'
              : 'Crea casa'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <p className="page-footnote">
        Inviti e condivisione saranno disponibili in una milestone successiva.
      </p>
    </div>
  )
}
