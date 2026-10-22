import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  atomicAddition,
  type AdditionRequest,
} from '../src/inventory/addition.ts'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    values,
  }
}
const request: AdditionRequest = {
  p_format_id: 'format',
  p_product: null,
  p_initial_state: { mode: 'unknown', certainty: 'unknown' },
}
const result = { home_product_id: 'hp', created: true, movement_id: 'movement' }

test('aggiunta invia una singola RPC completa e rimuove la chiave solo dopo successo', async () => {
  const store = storage()
  let calls = 0
  const actual = await atomicAddition(
    async (args) => {
      calls++
      assert.deepEqual(args, { ...request, p_home_id: 'home', p_key: 'key' })
      assert.equal(store.values.size, 1)
      return result
    },
    store,
    () => 'key',
    'actor',
    'home',
    request,
  )
  assert.deepEqual(actual, result)
  assert.equal(calls, 1)
  assert.equal(store.values.size, 0)
})

test('esito di rete perso conserva la stessa chiave su retry e refresh del chiamante', async () => {
  const store = storage()
  const keys: string[] = []
  await assert.rejects(
    atomicAddition(
      async (args) => {
        keys.push(args.p_key)
        throw new TypeError('network')
      },
      store,
      () => 'first',
      'actor',
      'home',
      request,
    ),
  )
  await atomicAddition(
    async (args) => {
      keys.push(args.p_key)
      return result
    },
    store,
    () => 'must-not-be-used',
    'actor',
    'home',
    structuredClone(request),
  )
  assert.deepEqual(keys, ['first', 'first'])
})

test('richieste diverse, case e account mantengono chiavi separate', async () => {
  const store = storage()
  const keys: string[] = []
  for (const [actor, home, format] of [
    ['a', 'h', 'f'],
    ['b', 'h', 'f'],
    ['a', 'other', 'f'],
    ['a', 'h', 'different'],
  ]) {
    await assert.rejects(
      atomicAddition(
        async (args) => {
          keys.push(args.p_key)
          throw Error('uncertain')
        },
        store,
        () => String(keys.length),
        actor,
        home,
        { ...request, p_format_id: format },
      ),
    )
  }
  assert.equal(new Set(keys).size, 4)
})

test('risposta incompleta non cancella la chiave e collegamento esistente è un successo senza movimento', async () => {
  const store = storage()
  await assert.rejects(
    atomicAddition(
      async () => ({}),
      store,
      () => 'key',
      'actor',
      'home',
      request,
    ),
  )
  assert.equal(store.values.size, 1)
  assert.deepEqual(
    await atomicAddition(
      async () => ({ ...result, created: false, movement_id: null }),
      store,
      () => 'other',
      'actor',
      'home',
      request,
    ),
    { ...result, created: false, movement_id: null },
  )
  assert.equal(store.values.size, 0)
})
