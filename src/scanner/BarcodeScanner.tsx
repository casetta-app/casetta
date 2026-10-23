import { recognizeProduct } from '../recognition/api'
import { ProposalEditor } from '../recognition/ProposalEditor'
import type { ExternalResult } from '../recognition/lookup'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  attachCatalogFormat,
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
  const dialog = useRef<HTMLDialogElement>(null)
  const [lookupState, setLookupState] = useState('idle')
  const [operationError, setOperationError] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const cleanup = useRef<() => void>(() => {})
  const generation = useRef(0)
  const alive = useRef(true)
  const suspended = useRef(false)
  const cameraReady = useRef(false)
  const [expandedPreview, setExpandedPreview] = useState(false)
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
  const [external, setExternal] = useState<ExternalResult | null>(null)

  function stop() {
    generation.current++
    cleanup.current()
    cleanup.current = () => {}
    cameraReady.current = false
    setRunning(false)
  }
  useEffect(() => {
    alive.current = true
    const windowElement = dialog.current!
    const previousFocus = document.activeElement as HTMLElement | null
    windowElement.showModal()
    const sessionGeneration = generation
    startRef.current()
    function suspend() {
      suspended.current = true
      cameraReady.current = false
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
      windowElement.close()
      previousFocus?.focus()
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
    setLookupState('searching')
    if (dialog.current) dialog.current.scrollTop = 0
    setResolved(false)
    setExternal(null)
    setBusy(true)
    setMessage('Codice riconosciuto. Cerco nel catalogo…')
    try {
      const result = await recognizeProduct(homeId, normalized)
      if (!alive.current) return
      if (result.status !== 'local') {
        setExternal(result)
        setMatches([])
        setLookupState(
          result.status === 'found' || result.status === 'incomplete'
            ? 'external'
            : result.status === 'editorial'
              ? 'editorial'
              : result.status === 'absent'
                ? 'absent'
                : 'external-error',
        )
        setMessage(
          {
            editorial:
              'Codice editoriale: inserisci i dati manualmente nella categoria Altro. Open Food Facts non viene consultato.',
            absent: 'Barcode assente anche da Open Food Facts.',
            unavailable: 'Servizio esterno temporaneamente non disponibile.',
            network: 'Errore di rete verso la fonte esterna.',
            timeout: 'Tempo scaduto nella ricerca esterna.',
            limited: 'Limite richieste raggiunto. Attendi e riprova.',
            found: 'Proposta Open Food Facts da confermare.',
            incomplete:
              'Dati Open Food Facts incompleti: completa la proposta.',
          }[result.status],
        )
        setResolved(true)
        return
      }
      const found = result.matches
      setLookupState(
        found.length > 1 ? 'ambiguous' : found.length ? 'found' : 'absent',
      )
      setMatches(found)
      setResolved(true)
      setMessage(
        found.length
          ? 'Lettura completata. Scegli e conferma il formato da registrare.'
          : 'Codice assente dal catalogo. Completa i dati manualmente.',
      )
    } catch (error) {
      if (alive.current) {
        setLookupState('error')
        setMessage(inventoryErrorMessage(error))
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  function start(confirmation = '') {
    stop()
    if (!video.current || document.hidden) return
    suspended.current = false
    const currentGeneration = generation.current
    setRunning(true)
    setOperationError('')
    setMessage(`${confirmation} Avvio della fotocamera…`.trim())
    cleanup.current = startBarcodeCamera(
      video.current,
      (raw) => void recognizeRef.current(raw),
      (error) => {
        if (alive.current && generation.current === currentGeneration) {
          cameraReady.current = false
          setRunning(false)
          setOperationError(cameraError(error))
          setMessage(cameraError(error))
        }
      },
      () => {
        if (alive.current && generation.current === currentGeneration) {
          cameraReady.current = true
          setMessage(
            `${confirmation} Fotocamera attiva. Inquadra un codice alla volta.`.trim(),
          )
        }
      },
      () => locked.current,
    )
  }
  const recognizeRef = useRef(recognize)
  recognizeRef.current = recognize
  const startRef = useRef(start)
  startRef.current = start

  function next(confirmation = '') {
    setExpandedPreview(false)
    locked.current = false
    setCode('')
    setLookupState('idle')
    setExternal(null)
    setOperationError('')
    setMatches([])
    setResolved(false)
    const stream = video.current?.srcObject as MediaStream | null
    const active =
      cameraReady.current &&
      stream?.getTracks().some((track) => track.readyState !== 'ended')
    if (!document.hidden && !suspended.current) {
      if (!active || video.current?.paused) start(confirmation)
      else
        setMessage(
          `${confirmation} Fotocamera attiva. Inquadra il prossimo codice.`.trim(),
        )
    } else {
      setMessage(
        `${confirmation} Fotocamera sospesa. Premi Riprendi fotocamera per continuare.`.trim(),
      )
    }
  }
  async function add(id: string) {
    if (busy) return
    setOperationError('')
    setBusy(true)
    try {
      const result = await attachCatalogFormat(homeId, id)
      if (!alive.current) return
      await onAdded()
      if (!alive.current) return
      next(
        result.created
          ? 'Prodotto registrato con disponibilità da verificare.'
          : 'Formato già nelle scorte: quantità invariata.',
      )
    } catch (error) {
      if (alive.current) setOperationError(inventoryErrorMessage(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      className="scanner-panel scanner-dialog"
      aria-label="Scanner barcode"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="scanner-sticky">
        <div className="panel-heading">
          <h2>Scansiona barcode</h2>
          <button type="button" onClick={onClose}>
            Chiudi scanner
          </button>
        </div>
      </div>
      <div
        className={`scanner-feedback scanner-${lookupState}`}
        role="status"
        aria-live="polite"
      >
        {code && <strong>Codice letto: {code}</strong>}
        {external &&
          (external.status === 'found' || external.status === 'incomplete') && (
            <p>
              {external.proposal.name || 'Nome da completare'} ·{' '}
              {external.proposal.brand || 'Marca non disponibile'}
            </p>
          )}
        {operationError && <p role="alert">{operationError}</p>}
        <p>
          {lookupState === 'found'
            ? 'Trovato nel catalogo.'
            : lookupState === 'ambiguous'
              ? 'Più corrispondenze: scegli il formato.'
              : lookupState === 'absent'
                ? 'Assente dal catalogo.'
                : lookupState === 'error'
                  ? 'Errore di ricerca. Il prodotto non è stato dichiarato sconosciuto.'
                  : operationError
                    ? ''
                    : message}
        </p>
      </div>
      <div className="scanner-body">
        <div
          className={`scanner-preview${code && !expandedPreview ? ' scanner-preview-compact' : ''}`}
          aria-hidden="true"
        >
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            aria-label="Anteprima fotocamera"
          />
          <span className="scanner-guide" />
        </div>
        <div className="scanner-controls">
          {code && (
            <button
              type="button"
              onClick={() => setExpandedPreview(!expandedPreview)}
            >
              {expandedPreview ? 'Riduci anteprima' : 'Mostra anteprima'}
            </button>
          )}
          {!running ? (
            <button type="button" onClick={() => void start()}>
              Riprendi fotocamera
            </button>
          ) : null}
        </div>
        <details className="scanner-manual">
          <summary>Inserisci codice a mano o ripeti una lettura</summary>
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
        </details>
        {code && (
          <>
            {['error', 'external-error'].includes(lookupState) && (
              <>
                <p role="alert">{message}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    seen.current.delete(barcodeVariants(code).sort().join(':'))
                    locked.current = false
                    void recognize(code)
                  }}
                >
                  Riprova ricerca
                </button>
              </>
            )}
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
            {external &&
              (external.status === 'found' ||
                external.status === 'incomplete') && (
                <ProposalEditor
                  key={code}
                  proposal={{ ...external.proposal, barcode: code }}
                  homeId={homeId}
                  busy={busy}
                  onBusy={(value) => {
                    if (alive.current) setBusy(value)
                  }}
                  onError={(error) => {
                    if (alive.current)
                      setOperationError(inventoryErrorMessage(error))
                  }}
                  onDone={async () => {
                    if (!alive.current) return
                    await onAdded()
                    if (alive.current) {
                      next('Prodotto confermato.')
                    }
                  }}
                />
              )}
            {resolved &&
              matches.length === 0 &&
              external?.status !== 'found' &&
              external?.status !== 'incomplete' && (
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
            <button type="button" disabled={busy} onClick={() => next()}>
              Prossimo codice
            </button>
          </>
        )}
      </div>
    </dialog>,
    document.body,
  )
}
