import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { AuthPage } from './auth/AuthPage'
import { ProtectedApp } from './auth/ProtectedApp'
import { bootstrapAuth } from './auth/bootstrap'
import { HomeGate } from './homes/HomeGate'
import { ManagementPage } from './pages/ManagementPage'
import { TodayPage } from './pages/TodayPage'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { StockPage } from './pages/StockPage'
import './styles.css'

async function start() {
  const initialError = await bootstrapAuth()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AuthProvider initialError={initialError}>
        <HashRouter>
          <Routes>
            <Route path="accedi" element={<AuthPage />} />
            <Route path="password" element={<AuthPage passwordChange />} />
            <Route element={<ProtectedApp />}>
              <Route index element={<Navigate to="oggi" replace />} />
              <Route
                path="oggi"
                element={
                  <HomeGate>
                    <TodayPage />
                  </HomeGate>
                }
              />
              <Route
                path="scorte"
                element={
                  <HomeGate>
                    <StockPage />
                  </HomeGate>
                }
              />
              <Route
                path="spesa"
                element={
                  <HomeGate>
                    <ComingSoonPage area="Spesa" />
                  </HomeGate>
                }
              />
              <Route
                path="gestione"
                element={
                  <HomeGate requireHome={false}>
                    <ManagementPage />
                  </HomeGate>
                }
              />
              <Route path="*" element={<Navigate to="/oggi" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </AuthProvider>
    </React.StrictMode>,
  )
}
void start()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
  })
}
