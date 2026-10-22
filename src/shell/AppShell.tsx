import { useAuth } from '../auth/AuthContext'
import { useState } from 'react'
import { useHomes } from '../homes/HomeContext'
import { roleLabels } from '../homes/selection'
import { supabase } from '../lib/supabase'
import { NavLink, Outlet } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { navigationItems } from './navigation'

export function AppShell() {
  const { error: authError } = useAuth()
  const { homes, activeHome, loading, notice } = useHomes()
  const { selectHome } = useHomes()
  const [logoutError, setLogoutError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  async function logout() {
    setLoggingOut(true)
    setLogoutError('')
    try {
      const { error } = await supabase!.auth.signOut({ scope: 'local' })
      if (error) throw error
    } catch {
      setLogoutError('Uscita non riuscita. Riprova.')
    } finally {
      setLoggingOut(false)
    }
  }
  return (
    <div className="app-frame">
      <header className="topbar">
        <a className="brand" href="#/oggi" aria-label="Casetta, vai a Oggi">
          <span className="brand-mark">
            <Icon name="home" size={19} />
          </span>
          <span>casetta</span>
        </a>
        <label className="home-switcher">
          <span className="home-avatar">
            <Icon name="home" size={16} />
          </span>
          <span className="home-switcher-copy">
            <span className="eyebrow">ABITAZIONE</span>
            <span className="home-active-name">
              {loading ? 'Verifica…' : (activeHome?.name ?? 'Nessuna casa')}
            </span>
          </span>
          <select
            aria-label="Cambia abitazione"
            value={loading ? '' : (activeHome?.id ?? '')}
            disabled={loading || homes.length === 0}
            onChange={(e) => selectHome(e.target.value)}
          >
            {(loading || !activeHome) && (
              <option value="">{loading ? 'Verifica…' : 'Nessuna casa'}</option>
            )}
            {!loading &&
              homes.map((home) => (
                <option key={home.id} value={home.id}>
                  {home.name}
                </option>
              ))}
          </select>
          {activeHome && (
            <span className="home-role">
              {roleLabels[activeHome.access.role]}
            </span>
          )}
        </label>
        <button
          className="setup-mark"
          onClick={() => void logout()}
          disabled={loggingOut}
        >
          {loggingOut ? 'Uscita…' : 'Esci'}
        </button>
      </header>

      <div className="content-layout">
        <aside className="side-nav" aria-label="Navigazione principale">
          <p className="nav-caption">LA TUA CASA</p>
          {navigationItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `nav-link${isActive ? ' active' : ''}`
              }
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          <div className="side-note">
            <span className="status-dot" /> Fondamenta in preparazione
          </div>
        </aside>
        <main id="main-content" className="main-content">
          {authError && <p role="alert">{authError}</p>}
          {logoutError && <p role="alert">{logoutError}</p>}
          {notice && <p role="status">{notice}</p>}
          <Outlet />
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Navigazione principale">
        {navigationItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `mobile-nav-link${isActive ? ' active' : ''}`
            }
          >
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
