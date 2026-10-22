import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import { TodayPage } from './pages/TodayPage'
import { ComingSoonPage } from './pages/ComingSoonPage'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="oggi" replace />} />
          <Route path="oggi" element={<TodayPage />} />
          <Route path="scorte" element={<ComingSoonPage area="Scorte" />} />
          <Route path="spesa" element={<ComingSoonPage area="Spesa" />} />
          <Route path="gestione" element={<ComingSoonPage area="Gestione" />} />
          <Route path="*" element={<Navigate to="/oggi" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  </React.StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
  })
}
