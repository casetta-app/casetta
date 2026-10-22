import { useState } from 'react'
import type { Proposal } from '../../supabase/functions/_shared/off'
import { createHomeProduct } from '../inventory/api'
import {
  newUnknownState,
  validateQuantity,
  type InventoryCategory,
} from '../inventory/model'
import { normalizeBarcode } from '../scanner/codes'
export function ProposalEditor({
  proposal,
  homeId,
  busy,
  onBusy,
  onDone,
  onError,
}: {
  proposal: Proposal
  homeId: string
  busy: boolean
  onBusy: (busy: boolean) => void
  onDone: () => Promise<void>
  onError: (error: unknown) => void
}) {
  const [draft, setDraft] = useState(proposal)
  const [category, setCategory] = useState<InventoryCategory>('food')
  const [kind, setKind] = useState<'packaged' | 'loose' | 'piece'>('packaged')
  const [editing, setEditing] = useState(
    !proposal.name || !proposal.brand || !proposal.label,
  )
  async function confirm() {
    if (busy) return
    const code = normalizeBarcode(draft.barcode),
      quantity = draft.quantity
        ? validateQuantity(draft.quantity, false, false)
        : ''
    if (
      !draft.name.trim() ||
      !code ||
      (draft.quantity && !quantity) ||
      Boolean(quantity) !== Boolean(draft.unit)
    ) {
      onError(new Error('Controlla nome, barcode e quantità/unità nominali.'))
      return
    }
    onBusy(true)
    try {
      await createHomeProduct(homeId, {
        name: draft.name,
        brand: draft.brand,
        category,
        kind,
        formatLabel: draft.label || draft.name,
        barcode: code,
        sizeQuantity: quantity || '',
        sizeUnit: draft.unit,
        initialState: newUnknownState(),
        sourceRef: proposal.sourceRef,
      })
      await onDone()
    } catch (error) {
      onError(error)
    } finally {
      onBusy(false)
    }
  }
  return (
    <section className="scanner-proposal" aria-label="Proposta Open Food Facts">
      <h3>{draft.name || 'Nome da completare'}</h3>
      <p>
        {draft.brand || 'Marca non disponibile'} ·{' '}
        {draft.label || 'Formato non disponibile'}
      </p>
      {draft.quantity && (
        <p>
          Quantità nominale confezione: {draft.quantity} {draft.unit}
        </p>
      )}
      <p>
        Fonte:{' '}
        <a href={proposal.sourceRef} target="_blank" rel="noreferrer">
          Open Food Facts
        </a>{' '}
        ·{' '}
        <a
          href="https://opendatacommons.org/licenses/odbl/1-0/"
          target="_blank"
          rel="noreferrer"
        >
          ODbL
        </a>
        . Dati suggeriti, da verificare.
      </p>
      <p>Quantità in casa: da verificare.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => setEditing(!editing)}
      >
        Modifica dati
      </button>
      {editing && (
        <div className="form-grid">
          {(['name', 'brand', 'label', 'barcode', 'quantity'] as const).map(
            (key) => (
              <label key={key}>
                {
                  {
                    name: 'Nome',
                    brand: 'Marca',
                    label: 'Formato/confezione',
                    barcode: 'Barcode proposta',
                    quantity: 'Quantità nominale',
                  }[key]
                }
                <input
                  maxLength={key === 'name' ? 160 : 120}
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                />
              </label>
            ),
          )}
          <label>
            Unità nominale
            <select
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
            >
              <option value="">Non specificata</option>
              {['g', 'kg', 'ml', 'l'].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          <label>
            Tipo
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="packaged">Confezionato</option>
              <option value="loose">Sfuso</option>
              <option value="piece">A pezzo</option>
            </select>
          </label>
          <label>
            Categoria
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as InventoryCategory)}
            >
              <option value="food">Alimentari</option>
              <option value="household">Casa</option>
              <option value="other">Altro</option>
            </select>
          </label>
        </div>
      )}
      <button
        type="button"
        disabled={busy || !draft.name.trim()}
        onClick={() => void confirm()}
      >
        Conferma prodotto
      </button>
    </section>
  )
}
