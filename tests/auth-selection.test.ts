import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authRedirect, readCallback } from '../src/auth/redirect.ts'
import { chooseHome, preferenceKey } from '../src/homes/selection.ts'

test('redirect produzione conserva /casetta/ senza hash', () => {
  assert.equal(
    authRedirect('https://casetta-app.github.io', '/casetta/'),
    'https://casetta-app.github.io/casetta/',
  )
  assert.equal(
    authRedirect('https://casetta-app.github.io', '/casetta/', true),
    'https://casetta-app.github.io/casetta/?recovery=1',
  )
})
test('redirect sviluppo conserva base e porta', () => {
  assert.equal(
    authRedirect('http://localhost:5173', '/casetta/', true),
    'http://localhost:5173/casetta/?recovery=1',
  )
})
test('callback conferma: codice nella query e pulizia prima del router', () => {
  const callback = readCallback(
    'https://casetta-app.github.io/casetta/?code=one-use&keep=yes#/scorte',
  )
  assert.equal(callback.code, 'one-use')
  assert.equal(
    callback.cleanUrl,
    'https://casetta-app.github.io/casetta/?keep=yes#/oggi',
  )
  assert.equal(callback.isCallback, true)
})
test('recupero: query PKCE instrada a password anche senza hash', () => {
  const callback = readCallback(
    'https://casetta-app.github.io/casetta/?recovery=1&code=one-use',
  )
  assert.equal(callback.recovery, true)
  assert.equal(
    callback.cleanUrl,
    'https://casetta-app.github.io/casetta/#/password',
  )
})
test('errore callback rimosso senza conservarne dettagli non affidabili', () => {
  const callback = readCallback(
    'https://casetta-app.github.io/casetta/?error=access_denied&error_code=otp_expired&error_description=expired&recovery=1',
  )
  assert.equal(callback.error, 'expired')
  assert.equal(
    callback.cleanUrl,
    'https://casetta-app.github.io/casetta/#/oggi',
  )
})
test('navigazione normale non viene modificata né interpretata come callback', () => {
  const url = 'https://casetta-app.github.io/casetta/#/gestione?code=not-auth'
  assert.equal(readCallback(url).isCallback, false)
  assert.equal(readCallback(url).code, null)
  assert.equal(readCallback(url).cleanUrl, url)
})
test('refresh seleziona ultima casa solo se tuttora autorizzata', () => {
  const homes = [{ id: 'a' }, { id: 'b' }]
  assert.equal(chooseHome(homes, 'b'), homes[1])
  assert.equal(chooseHome(homes, 'revoked'), homes[0])
  assert.equal(chooseHome([], 'revoked'), null)
  assert.equal(chooseHome(homes, null), homes[0])
})
test('preferenza abitazione separata per account', () => {
  assert.notEqual(preferenceKey('a'), preferenceKey('b'))
})

import { completeCallback } from '../src/auth/completeCallback.ts'

test('callback scambia una sola volta dopo aver pulito URL', async () => {
  const events: string[] = []
  const error = await completeCallback(
    'https://casetta-app.github.io/casetta/?code=one-use',
    {
      replaceUrl: (url) => {
        events.push(url)
      },
      exchange: async (code) => {
        events.push(code)
        return { error: null }
      },
    },
  )
  assert.equal(error, null)
  assert.deepEqual(events, [
    'https://casetta-app.github.io/casetta/#/oggi',
    'one-use',
  ])
})
test('sessione al refresh normale non consuma nuovamente il codice', async () => {
  const unexpected = () => {
    throw Error('Unexpected callback')
  }
  assert.equal(
    await completeCallback('https://casetta-app.github.io/casetta/#/oggi', {
      replaceUrl: unexpected,
      exchange: unexpected,
    }),
    null,
  )
})
test('recupero indirizza a modifica password prima dello scambio', async () => {
  let destination = ''
  assert.equal(
    await completeCallback(
      'https://casetta-app.github.io/casetta/?code=one-use&recovery=1',
      {
        replaceUrl: (url) => {
          destination = url
        },
        exchange: async () => {
          assert.equal(
            destination,
            'https://casetta-app.github.io/casetta/#/password',
          )
          return { error: null }
        },
      },
    ),
    null,
  )
})
test('verifier assente o codice consumato restituisce errore recuperabile', async () => {
  const error = await completeCallback(
    'https://casetta-app.github.io/casetta/?code=one-use',
    {
      replaceUrl: () => {},
      exchange: async () => ({ error: new Error('Missing verifier') }),
    },
  )
  assert.match(error!, /browser diverso/)
})
test('rete assente e configurazione mancante sono gestite', async () => {
  const href = 'https://casetta-app.github.io/casetta/?code=one-use'
  assert.match(
    (await completeCallback(href, { replaceUrl: () => {}, exchange: null }))!,
    /Configura Supabase/,
  )
  assert.match(
    (await completeCallback(href, {
      replaceUrl: () => {},
      exchange: async () => {
        throw Error('offline')
      },
    }))!,
    /Connessione/,
  )
})
