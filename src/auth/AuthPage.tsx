import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { authRedirect } from './redirect'
import {
  authErrorFeedback,
  authResultFeedback,
  type AuthFeedback,
  type AuthOperation,
} from './feedback'

export function AuthPage({
  passwordChange = false,
}: {
  passwordChange?: boolean
}) {
  const { session, loading, error: sessionError } = useAuth()
  const [mode, setMode] = useState<'login' | 'signup' | 'reset' | 'resend'>(
    'login',
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [retryAfter, setRetryAfter] = useState(0)
  const submitting = useRef(false)
  useEffect(() => {
    if (retryAfter <= 0) return
    const timeout = window.setTimeout(
      () => setRetryAfter((value) => Math.max(0, value - 1)),
      1000,
    )
    return () => window.clearTimeout(timeout)
  }, [retryAfter])
  function showFeedback(feedback: AuthFeedback) {
    setError(feedback.tone === 'error' ? feedback.message : '')
    setMessage(feedback.tone === 'success' ? feedback.message : '')
    setRetryAfter(feedback.retryAfterSeconds)
    if (feedback.tone === 'success') {
      setPassword('')
      setConfirmation('')
    }
    // Solo metadati consentiti, solo in sviluppo: mai errori grezzi, email o token.
    if (import.meta.env.DEV && feedback.diagnostic)
      console.warn('[Casetta Auth]', feedback.diagnostic)
  }
  if (!supabase)
    return (
      <section className="auth-card">
        <h1>Casetta</h1>
        <h2>Collegamento da configurare</h2>
        <p>
          Per accedere serve la configurazione Supabase. Consulta il README del
          progetto.
        </p>
      </section>
    )
  if (loading)
    return (
      <p role="status" className="auth-card">
        Recupero della sessione…
      </p>
    )
  if (session && !passwordChange) return <Navigate to="/oggi" replace />
  if (passwordChange && !session)
    return (
      <section className="auth-card">
        <h1>Nuova password</h1>
        <p>
          Apri il link di recupero ricevuto via email nello stesso browser da
          cui lo hai richiesto.
        </p>
        {sessionError && <p role="alert">{sessionError}</p>}
        <Link to="/accedi">Torna all’accesso</Link>
      </section>
    )
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase || submitting.current || retryAfter > 0) return
    setError('')
    setMessage('')
    if (passwordChange && password !== confirmation) {
      setError('Le password non coincidono.')
      return
    }
    submitting.current = true
    setBusy(true)
    const operation: AuthOperation = passwordChange ? 'password' : mode
    try {
      const redirect = authRedirect(
        window.location.origin,
        import.meta.env.BASE_URL,
        mode === 'reset',
      )
      const result = passwordChange
        ? await supabase.auth.updateUser({ password })
        : mode === 'signup'
          ? await supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: redirect },
            })
          : mode === 'reset'
            ? await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: redirect,
              })
            : mode === 'resend'
              ? await supabase.auth.resend({
                  type: 'signup',
                  email,
                  options: { emailRedirectTo: redirect },
                })
              : await supabase.auth.signInWithPassword({ email, password })
      showFeedback(authResultFeedback(operation, result))
    } catch (failure) {
      showFeedback(authErrorFeedback(operation, failure))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  return (
    <section className="auth-card">
      <p className="eyebrow">CASETTA · IL TUO ACCOUNT</p>
      <h1>
        {passwordChange
          ? 'Nuova password'
          : mode === 'resend'
            ? 'Conferma la tua email'
            : mode === 'signup'
              ? 'Crea un account'
              : mode === 'reset'
                ? 'Recupera accesso'
                : 'Bentornato'}
      </h1>
      <p>
        Il tuo account può accedere a più abitazioni, ciascuna con i propri
        permessi.
      </p>
      <form onSubmit={submit}>
        {!passwordChange && (
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {(passwordChange || mode === 'login' || mode === 'signup') && (
          <label>
            Password
            <input
              type="password"
              required
              minLength={mode === 'login' && !passwordChange ? 1 : 12}
              autoComplete={
                passwordChange || mode === 'signup'
                  ? 'new-password'
                  : 'current-password'
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {(passwordChange || mode === 'signup') && (
          <p className="page-footnote">Usa almeno 12 caratteri.</p>
        )}
        {passwordChange && (
          <label>
            Ripeti password
            <input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        <button className="primary-button" disabled={busy || retryAfter > 0}>
          {busy
            ? 'Attendi…'
            : passwordChange
              ? 'Salva password'
              : mode === 'signup'
                ? 'Registrati'
                : mode === 'reset'
                  ? 'Invia link di recupero'
                  : mode === 'resend'
                    ? 'Reinvia conferma email'
                    : 'Accedi'}
        </button>
      </form>
      {(error || (!busy && !message && sessionError)) && (
        <p role="alert">{error || sessionError}</p>
      )}
      {message && <p role="status">{message}</p>}
      {retryAfter > 0 && (
        <p role="status">Puoi riprovare tra {retryAfter} secondi.</p>
      )}
      {passwordChange ? (
        <Link to="/oggi">Torna a Casetta</Link>
      ) : (
        <div className="form-actions">
          {(['login', 'signup', 'reset', 'resend'] as const)
            .filter((m) => m !== mode)
            .map((m) => (
              <button
                key={m}
                disabled={busy}
                onClick={() => {
                  setMode(m)
                  setError('')
                  setMessage('')
                  setPassword('')
                }}
              >
                {m === 'login'
                  ? 'Accedi'
                  : m === 'signup'
                    ? 'Crea account'
                    : m === 'resend'
                      ? 'Reinvia conferma email'
                      : 'Password dimenticata?'}
              </button>
            ))}
        </div>
      )}
    </section>
  )
}
