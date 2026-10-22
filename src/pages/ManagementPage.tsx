import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useHomes } from '../homes/HomeContext'
import { CreateHomeForm } from '../homes/CreateHomeForm'
import { roleLabels } from '../homes/selection'
export function ManagementPage() {
  const { session } = useAuth()
  const { homes, activeHome, refresh } = useHomes()
  return (
    <section className="page">
      <p className="eyebrow">CASETTA · ACCOUNT E CASE</p>
      <h1>Gestione</h1>
      <div className="management-card">
        <h2>Il tuo account</h2>
        <p>{session?.user.email}</p>
        <Link to="/password">Modifica password</Link>
      </div>
      <div className="management-card">
        <h2>Le tue abitazioni</h2>
        {homes.length ? (
          <ul>
            {homes.map((home) => (
              <li key={home.id}>
                {home.name} · {roleLabels[home.access.role]}
                {home.id === activeHome?.id ? ' · Selezionata' : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p>Nessuna abitazione accessibile.</p>
        )}
        <button onClick={() => void refresh()}>Verifica gli accessi</button>
        <p className="page-footnote">
          Membri e inviti: gestione nell’interfaccia prevista per M4.
        </p>
      </div>
      <CreateHomeForm />
    </section>
  )
}
