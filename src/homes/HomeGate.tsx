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
  if (loading) return <p role="status">Verifica delle abitazioni…</p>
  if (error)
    return (
      <section>
        <p role="alert">{error}</p>
        <button onClick={() => void refresh()}>Riprova</button>
      </section>
    )
  if (requireHome && !activeHome)
    return (
      <section className="page">
        <h1>Benvenuto a casa</h1>
        <p>
          Non hai ancora abitazioni accessibili. Puoi creare la tua prima casa
          quando vuoi.
        </p>
        <CreateHomeForm />
      </section>
    )
  return (
    <div
      key={
        requireHome
          ? `${activeHome?.id}:${activeHome?.access.role}`
          : 'management'
      }
    >
      {children}
    </div>
  )
}
