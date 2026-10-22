import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { authErrorFeedback, authResultFeedback } from '../src/auth/feedback.ts'

const confirmedLater = authResultFeedback('signup', {
  error: null,
  data: { user: {}, session: null },
})

test('registrazione senza sessione è conferma richiesta, non errore', () => {
  assert.equal(confirmedLater.kind, 'confirmation-required')
  assert.equal(confirmedLater.tone, 'success')
  assert.match(confirmedLater.message, /email/)
  assert.equal(confirmedLater.diagnostic, undefined)
})
test('registrazione con sessione è accesso effettuato', () => {
  assert.equal(
    authResultFeedback('signup', { error: null, data: { session: {} } }).kind,
    'signed-in',
  )
})
test('account esistente e risposta offuscata hanno lo stesso feedback della conferma richiesta', () => {
  for (const code of ['user_already_exists', 'email_exists']) {
    assert.deepEqual(
      authErrorFeedback(
        'signup',
        new AuthApiError('User already registered', 422, code),
      ),
      confirmedLater,
    )
  }
  assert.deepEqual(
    authResultFeedback('signup', {
      error: null,
      data: { user: { identities: [] }, session: null },
    }),
    confirmedLater,
  )
})
test('recupero e reinvio non rivelano se l’account esiste', () => {
  for (const operation of ['reset', 'resend'] as const) {
    for (const code of [
      'user_not_found',
      'email_not_confirmed',
      'user_banned',
      'user_already_exists',
    ]) {
      assert.deepEqual(
        authErrorFeedback(
          operation,
          new AuthApiError('Private account information', 400, code),
        ),
        authResultFeedback(operation, { error: null }),
      )
    }
  }
})
test('rate limit email, richieste e HTTP 429 producono attesa esplicita', () => {
  for (const error of [
    new AuthApiError('limited', 429, 'over_email_send_rate_limit'),
    new AuthApiError('limited', 429, 'over_request_rate_limit'),
    new AuthApiError('limited', 429),
    { code: 'over_email_send_rate_limit' },
  ]) {
    const feedback = authErrorFeedback('signup', error)
    assert.equal(feedback.kind, 'rate-limit')
    assert.equal(feedback.retryAfterSeconds, 60)
    assert.match(feedback.message, /Attendi/)
  }
})
test('errore rete restituito in result.error è riconosciuto senza passare dal catch', () => {
  const feedback = authResultFeedback('signup', {
    error: new AuthRetryableFetchError('Fetch failed', 0),
  })
  assert.equal(feedback.kind, 'network')
  assert.equal(feedback.tone, 'error')
  assert.match(feedback.message, /esito/)
  assert.match(feedback.message, /ricevuto/)
})
test('fetch che lancia TypeError e timeout mantengono esito incerto', () => {
  for (const error of [
    new TypeError('Failed to fetch'),
    { name: 'AbortError' },
    { name: 'TimeoutError' },
    { code: 'request_timeout', status: 408 },
  ])
    assert.equal(authErrorFeedback('signup', error).kind, 'network')
})
test('HTTP 5xx del SDK retryable è indisponibilità servizio, distinta dalla rete client', () => {
  for (const error of [
    new AuthRetryableFetchError('gateway', 502),
    new AuthApiError('Internal detail', 500, 'unexpected_failure'),
  ]) {
    const feedback = authErrorFeedback('signup', error)
    assert.equal(feedback.kind, 'service')
    assert.match(feedback.message, /email/)
  }
})
test('credenziali errate, account assente e non confermato non sono distinguibili nel messaggio login', () => {
  const messages = [
    'invalid_credentials',
    'user_not_found',
    'email_not_confirmed',
    'user_banned',
  ].map(
    (code) =>
      authErrorFeedback('login', new AuthApiError('Private detail', 400, code))
        .message,
  )
  assert.equal(new Set(messages).size, 1)
})
test('password debole e indirizzo invalido hanno indicazioni utilizzabili', () => {
  assert.match(
    authErrorFeedback('signup', { code: 'weak_password' }).message,
    /12 caratteri/,
  )
  assert.match(
    authErrorFeedback('signup', { code: 'email_address_invalid' }).message,
    /formato/,
  )
})
test('registrazione disabilitata e problemi invio email sono errori reali, non successo', () => {
  for (const code of [
    'signup_disabled',
    'email_provider_disabled',
    'email_address_not_authorized',
  ])
    assert.equal(authErrorFeedback('signup', { code }).tone, 'error')
})
test('cambio password distingue password uguale e riautenticazione necessaria', () => {
  assert.match(
    authErrorFeedback('password', { code: 'same_password' }).message,
    /diversa/,
  )
  assert.match(
    authErrorFeedback('password', { code: 'reauthentication_needed' }).message,
    /Accedi nuovamente/,
  )
  assert.equal(
    authResultFeedback('password', { error: null }).kind,
    'password-updated',
  )
})
test('messaggi e diagnostica non includono errori grezzi, token o codici non autorizzati', () => {
  const feedback = authErrorFeedback('signup', {
    code: 'private-token',
    message: 'private-email private-password private-token',
    status: 400,
    user: 'private-user',
    request_id: 'private-request',
  })
  assert.equal(feedback.kind, 'unexpected')
  assert.doesNotMatch(JSON.stringify(feedback), /private-/)
  assert.equal(feedback.diagnostic?.status, 400)
})
test('errori inattesi o non strutturati non diventano successi', () => {
  for (const error of [
    'private-payload',
    undefined,
    new Error('Unexpected failure'),
  ])
    assert.equal(authErrorFeedback('signup', error).tone, 'error')
})

test('risposta signup priva sia di utente sia di sessione non viene dichiarata riuscita', () => {
  assert.equal(
    authResultFeedback('signup', {
      error: null,
      data: { user: null, session: null },
    }).tone,
    'error',
  )
})
