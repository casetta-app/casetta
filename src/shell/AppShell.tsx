import { NavLink, Outlet } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { navigationItems } from './navigation'

export function AppShell() {
  return (
    <div className="app-frame">
      <header className="topbar">
        <a className="brand" href="#/oggi" aria-label="Casetta, vai a Oggi">
          <span className="brand-mark">
            <Icon name="home" size={19} />
          </span>
          <span>casetta</span>
        </a>
        <button
          className="home-switcher"
          type="button"
          disabled
          aria-label="Nessuna casa collegata"
        >
          <span className="home-avatar">
            <Icon name="home" size={16} />
          </span>
          <span className="home-switcher-copy">
            <span className="eyebrow">ABITAZIONE</span>
            <span>Nessuna casa collegata</span>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        <div className="setup-mark" aria-label="Setup iniziale">
          M0-A
        </div>
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
