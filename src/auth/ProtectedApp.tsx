import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { HomeProvider } from '../homes/HomeProvider'
import { AppShell } from '../shell/AppShell'
export function ProtectedApp() {
  const { loading, session } = useAuth()
  if (loading)
    return (
      <p className="auth-card" role="status">
        Recupero della sessione…
      </p>
    )
  if (!session) return <Navigate to="/accedi" replace />
  return (
    <HomeProvider key={session.user.id}>
      <AppShell />
    </HomeProvider>
  )
}
