export type AuthOperation = 'login' | 'signup' | 'reset' | 'resend' | 'password'
export type AuthFeedback = {
  kind:
    | 'confirmation-required'
    | 'signed-in'
    | 'email-instructions'
    | 'password-updated'
    | 'rate-limit'
    | 'network'
    | 'service'
    | 'credentials'
    | 'validation'
    | 'unexpected'
  tone: 'success' | 'error'
  message: string
  retryAfterSeconds: number
  diagnostic?: {
    operation: AuthOperation
    kind: string
    code?: string
    status?: number
  }
}

type AuthResult = {
  error: unknown
  data?: { session?: unknown; user?: unknown } | null
}
const confirmationMessage =
  'Richiesta ricevuta. Se occorre confermare questo indirizzo, riceverai un’email: apri il link in questo browser. Se hai già un account, accedi o recupera la password.'
const recoveryMessage =
  'Se previsto per questo indirizzo, riceverai un link di recupero. Aprilo in questo browser. Controlla anche la posta indesiderata.'
const credentialsMessage =
  'Accesso non riuscito. Verifica email e password oppure usa la conferma email o il recupero accesso.'
const accountCodes = new Set([
  'user_already_exists',
  'email_exists',
  'user_not_found',
  'user_banned',
  'email_not_confirmed',
])
const rateCodes = new Set([
  'over_email_send_rate_limit',
  'over_request_rate_limit',
])
const safeCodes = new Set([
  ...rateCodes,
  'weak_password',
  'email_address_invalid',
  'validation_failed',
  'signup_disabled',
  'email_provider_disabled',
  'email_address_not_authorized',
  'unexpected_failure',
  'request_timeout',
  'captcha_failed',
  'same_password',
  'reauthentication_needed',
  'reauthentication_not_valid',
  'hook_timeout',
  'hook_timeout_after_retry',
])
function emailInstructions(operation: AuthOperation): AuthFeedback {
  return {
    kind:
      operation === 'signup' ? 'confirmation-required' : 'email-instructions',
    tone: 'success',
    message: operation === 'reset' ? recoveryMessage : confirmationMessage,
    retryAfterSeconds: 0,
  }
}

// Non legge message, user, identities o email e non effettua verifiche dell'esistenza account.
export function authErrorFeedback(
  operation: AuthOperation,
  error: unknown,
): AuthFeedback {
  const detail =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)
      : {}
  const code = typeof detail.code === 'string' ? detail.code : undefined
  const status =
    typeof detail.status === 'number' &&
    Number.isInteger(detail.status) &&
    detail.status >= 0 &&
    detail.status <= 599
      ? detail.status
      : undefined
  if (
    operation !== 'login' &&
    operation !== 'password' &&
    code &&
    accountCodes.has(code)
  )
    return emailInstructions(operation)
  function failure(
    kind: AuthFeedback['kind'],
    message: string,
    retryAfterSeconds = 0,
  ): AuthFeedback {
    return {
      kind,
      tone: 'error',
      message,
      retryAfterSeconds,
      diagnostic: {
        operation,
        kind,
        ...(code && safeCodes.has(code) ? { code } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    }
  }
  if (status === 429 || (code && rateCodes.has(code)))
    return failure(
      'rate-limit',
      'Troppe richieste. Attendi prima di riprovare. Se hai già ricevuto un’email, usa quel link.',
      60,
    )
  if (
    (status !== undefined && status >= 500) ||
    code === 'unexpected_failure' ||
    code === 'hook_timeout' ||
    code === 'hook_timeout_after_retry'
  )
    return failure(
      'service',
      'Il servizio di accesso non è disponibile al momento. Se hai già ricevuto un’email di conferma, prova quel link prima di ripetere la richiesta.',
    )
  if (
    detail.name === 'AuthRetryableFetchError' ||
    detail.name === 'AbortError' ||
    detail.name === 'TimeoutError' ||
    detail.name === 'TypeError' ||
    status === 0 ||
    status === 408 ||
    code === 'request_timeout'
  )
    return failure(
      'network',
      'Non abbiamo potuto confermare l’esito della richiesta. Controlla la connessione e verifica se hai già ricevuto l’email prima di riprovare.',
    )
  if (
    operation === 'login' &&
    (code === 'invalid_credentials' || (code && accountCodes.has(code)))
  )
    return failure('credentials', credentialsMessage)
  if (code === 'weak_password')
    return failure(
      'validation',
      'Scegli una password di almeno 12 caratteri che rispetti i requisiti del servizio. Evita password troppo comuni.',
    )
  if (code === 'email_address_invalid' || code === 'validation_failed')
    return failure(
      'validation',
      'Controlla il formato dell’email e i requisiti della password.',
    )
  if (code === 'signup_disabled' || code === 'email_provider_disabled')
    return failure(
      'service',
      'La registrazione via email non è disponibile al momento. Riprova più tardi.',
    )
  if (code === 'email_address_not_authorized')
    return failure(
      'service',
      'Il servizio non può completare l’invio email al momento. Se hai già ricevuto un messaggio, usa quel link; altrimenti riprova più tardi.',
    )
  if (code === 'captcha_failed')
    return failure(
      'validation',
      'La verifica di sicurezza non è riuscita. Riprova più tardi; se il problema continua, contatta chi gestisce Casetta.',
    )
  if (operation === 'password' && code === 'same_password')
    return failure(
      'validation',
      'Scegli una password diversa da quella attuale.',
    )
  if (
    operation === 'password' &&
    (code === 'reauthentication_needed' ||
      code === 'reauthentication_not_valid')
  )
    return failure(
      'credentials',
      'Accedi nuovamente, poi riprova a modificare la password.',
    )
  return failure(
    'unexpected',
    'Non è stato possibile completare la richiesta. Se hai già ricevuto un’email di conferma, prova quel link. Se il problema continua, contatta chi gestisce Casetta.',
  )
}

export function authResultFeedback(
  operation: AuthOperation,
  result: AuthResult,
): AuthFeedback {
  if (result.error) return authErrorFeedback(operation, result.error)
  if (operation === 'signup' && !result.data?.user && !result.data?.session)
    return authErrorFeedback(operation, { code: 'invalid_response' })
  if (operation === 'signup')
    return result.data?.session
      ? {
          kind: 'signed-in',
          tone: 'success',
          message: 'Accesso effettuato.',
          retryAfterSeconds: 0,
        }
      : emailInstructions(operation)
  if (operation === 'resend' || operation === 'reset')
    return emailInstructions(operation)
  return {
    kind: operation === 'password' ? 'password-updated' : 'signed-in',
    tone: 'success',
    message:
      operation === 'password' ? 'Password aggiornata.' : 'Accesso effettuato.',
    retryAfterSeconds: 0,
  }
}
