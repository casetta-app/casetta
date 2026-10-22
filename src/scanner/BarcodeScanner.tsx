import { useEffect, useRef, useState } from 'react'
import {
  attachCatalogFormat,
  findBarcodeFormats,
  inventoryErrorMessage,
  type BarcodeMatch,
} from '../inventory/api'
import { startBarcodeCamera } from './camera'
import { barcodeVariants, cameraError, normalizeBarcode } from './codes'

export function BarcodeScanner({
  homeId,
  onClose,
  onManual,
  onAdded,
}: {
  homeId: string
  onClose: () => void
  onManual: (code: string) => void
  onAdded: () => Promise<void>
}) {
  const video = useRef<HTMLVideoElement>(null)
  const cleanup = useRef<() => void>(() => {})
  const generation = useRef(0)
  const alive = useRef(true)
  const locked = useRef(false)
  const seen = useRef(new Set<string>())
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState(
    'Inquadra il codice con una buona luce oppure inseriscilo a mano.',
  )
  const [manual, setManual] = useState('')
  const [code, setCode] = useState('')
  const [matches, setMatches] = useState<BarcodeMatch[]>([])
  const [busy, setBusy] = useState(false)
  const [resolved, setResolved] = useState(false)

  function stop() {
    generation.current++
    cleanup.current()
    cleanup.current = () => {}
    setRunning(false)
  }
  useEffect(() => {
    alive.current = true
    const sessionGeneration = generation
    startRef.current()
    function suspend() {
      generation.current++
      cleanup.current()
      cleanup.current = () => {}
      setRunning(false)
      setMessage(
        'Fotocamera arrestata. Premi Riprendi fotocamera per riprendere.',
      )
    }
    function visibility() {
      if (document.hidden) suspend()
    }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', suspend)
    return () => {
      alive.current = false
      sessionGeneration.current++
      cleanup.current()
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', suspend)
    }
  }, [])

  async function recognize(raw: string) {
    if (locked.current) return
    const normalized = normalizeBarcode(raw)
    if (!normalized) {
      setMessage(
        'Codice non valido o incompleto. Controlla le cifre e riprova.',
      )
      return
    }
    const canonical = barcodeVariants(normalized).sort().join(':')
    if (seen.current.has(canonical)) {
      setMessage(
        'Codice già letto in questa sessione. Puoi abilitare una nuova lettura.',
      )
      return
    }
    seen.current.add(canonical)
    locked.current = true
    setCode(normalized)
    setResolved(false)
    setBusy(true)
    setMessage('Codice riconosciuto. Cerco nel catalogo…')
    try {
      const found = await findBarcodeFormats(
        homeId,
        barcodeVariants(normalized),
      )
      if (!alive.current) return
      setMatches(found)
      setResolved(true)
      setMessage(
        found.length
          ? 'Lettura completata. Scegli e conferma il formato da registrare.'
          : 'Codice assente dal catalogo. Completa i dati manualmente.',
      )
    } catch (error) {
      if (alive.current) setMessage(inventoryErrorMessage(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  function start() {
    stop()
    if (!video.current || document.hidden) return
    setRunning(true)
    setMessage('Avvio della fotocamera…')
    cleanup.current = startBarcodeCamera(
      video.current,
      (raw) => void recognizeRef.current(raw),
      (error) => {
        if (alive.current) {
          setRunning(false)
          setMessage(cameraError(error))
        }
      },
      () => {
        if (alive.current)
          setMessage('Fotocamera attiva. Inquadra un codice alla volta.')
      },
    )
  }
  const recognizeRef = useRef(recognize)
  recognizeRef.current = recognize
  const startRef = useRef(start)
  startRef.current = start

  function next() {
    locked.current = false
    setCode('')
    setMatches([])
    setResolved(false)
    setMessage(
      'Pronto per il prossimo codice. Nessuna quantità viene aggiunta dalla sola lettura.',
    )
  }
  async function add(id: string) {
    if (busy) return
    setBusy(true)
    try {
      const result = await attachCatalogFormat(homeId, id)
      if (!alive.current) return
      await onAdded()
      if (!alive.current) return
      next()
      setMessage(
        result.created
          ? 'Prodotto registrato con disponibilità da verificare. Puoi leggere il prossimo codice.'
          : 'Formato già nelle scorte: quantità invariata. Puoi leggere il prossimo codice.',
      )
    } catch (error) {
      if (alive.current) setMessage(inventoryErrorMessage(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <section className="scanner-panel" aria-label="Scanner barcode">
      <div className="panel-heading">
        <h3>Scansiona un codice</h3>
        <button type="button" onClick={onClose}>
          Chiudi scanner
        </button>
      </div>
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        aria-label="Anteprima fotocamera"
      />
      <div className="scanner-controls">
        {!running ? (
          <button type="button" onClick={() => void start()}>
            Riprendi fotocamera
          </button>
        ) : (
          <button type="button" onClick={stop}>
            Arresta fotocamera
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            seen.current.clear()
            next()
          }}
        >
          Abilita nuova lettura dello stesso codice
        </button>
      </div>
      <p role="status">{message}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void recognize(manual)
        }}
      >
        <label>
          Barcode manuale
          <input
            inputMode="numeric"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button disabled={busy || Boolean(code)}>Cerca codice</button>
      </form>
      {code && (
        <>
          <strong>Codice letto: {code}</strong>
          <p>La lettura non modifica le scorte.</p>
          {resolved &&
            matches.map((match) => (
              <div className="scanner-match" key={match.id}>
                <span>
                  {match.products.name} {match.products.brand} · {match.label}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void add(match.id)}
                >
                  Conferma aggiunta
                </button>
              </div>
            ))}
          {resolved && matches.length === 0 && (
            <button
              type="button"
              onClick={() => {
                stop()
                onManual(code)
              }}
            >
              Inserisci prodotto con questo barcode
            </button>
          )}
          <button type="button" disabled={busy} onClick={next}>
            Prossimo codice
          </button>
        </>
      )}
    </section>
  )
}
