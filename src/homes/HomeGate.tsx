import type { ReactNode } from 'react'
import { useHomes } from './HomeContext'
import { CreateHomeForm } from './CreateHomeForm'
export function HomeGate({
  children,
  requireHome = true,
}: {
  children: ReactNode
  requireHome?: boolean
}) {
  const { loading, error, activeHome, refresh } = useHomes()
  return (
    <>
      {loading && <p role="status">Verifica delle abitazioni…</p>}
      {error && (
        <section>
          <p role="alert">{error}</p>
          <button onClick={() => void refresh()}>Riprova</button>
        </section>
      )}
      <div hidden={loading || Boolean(error)}>
        {requireHome && !activeHome ? (
          <section className="page">
            <h1>Benvenuto a casa</h1>
            <p>
              Non hai ancora abitazioni accessibili. Puoi creare la tua prima
              casa quando vuoi.
            </p>
            <CreateHomeForm />
          </section>
        ) : (
          children
        )}
      </div>
    </>
  )
}
