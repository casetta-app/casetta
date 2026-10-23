import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  relevantTasks,
  taskDate,
  isClosed,
  type Task,
} from '../src/tasks/model.ts'
const fixture = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  owner_user_id: 'me',
  home_id: null,
  title: id,
  kind: 'chore',
  importance: 2,
  state: 'open',
  source: 'user_declared',
  timezone: 'Europe/Rome',
  due_at: null,
  due_local: null,
  snoozed_until: null,
  version: 1,
  ...patch,
})
test('Oggi: scadute, da verificare, future e senza data; concluse escluse', () => {
  const tasks = [
    fixture('closed', { state: 'completed' }),
    fixture('future', { due_at: '2030-01-01T08:00Z' }),
    fixture('late', { due_at: '2020-01-01T08:00Z' }),
    fixture('verify', { state: 'needs_verification' }),
    fixture('undated'),
  ]
  assert.deepEqual(
    relevantTasks(tasks, Date.parse('2029-01-01')).map((t) => t.id),
    ['late', 'verify', 'future', 'undated'],
  )
  assert.equal(isClosed(fixture('cancel', { state: 'cancelled' })), true)
})
test('rinvio cambia attenzione senza riscrivere scadenza; importanza risolve pari urgenza', () => {
  const t = fixture('snoozed', {
    state: 'snoozed',
    due_at: '2020-01-01T08:00Z',
    snoozed_until: '2040-01-01T08:00Z',
  })
  assert.deepEqual(
    relevantTasks(
      [t, fixture('urgent', { importance: 3, due_at: '2020-01-01T08:00Z' })],
      Date.parse('2030-01-01'),
    ).map((t) => t.id),
    ['urgent', 'snoozed'],
  )
  assert.equal(t.due_at, '2020-01-01T08:00Z')
})
test('date mostrate nel fuso della responsabilità anche attraverso ora legale', () => {
  assert.match(
    taskDate(fixture('spring', { due_at: '2027-03-28T07:00Z' })),
    /09:00/,
  )
  assert.match(
    taskDate(fixture('autumn', { due_at: '2027-10-31T01:30Z' })),
    /02:30/,
  )
  assert.equal(taskDate(fixture('no-date')), 'Senza data')
})

test('fuso non supportato dal browser non provoca crash e mostra UTC esplicito', () => {
  assert.match(
    taskDate(
      fixture('zone', {
        due_at: '2027-03-28T07:00Z',
        timezone: 'Unknown/Zone',
      }),
    ),
    /UTC/,
  )
})

test('rinviata resta aperta e torna rilevante alla data di attenzione; start/confirm non sono conclusioni', () => {
  const snoozed = fixture('rinviata', {
    importance: 3,
    state: 'snoozed',
    due_at: '2020-01-01T08:00Z',
    snoozed_until: '2030-01-01T08:00Z',
  })
  const ordinary = fixture('corrente', { due_at: '2029-01-01T08:00Z' })
  assert.equal(isClosed(snoozed), false)
  assert.deepEqual(
    relevantTasks([snoozed, ordinary], Date.parse('2029-02-01')).map(
      (t) => t.id,
    ),
    ['corrente', 'rinviata'],
  )
  assert.deepEqual(
    relevantTasks([snoozed, ordinary], Date.parse('2030-01-02')).map(
      (t) => t.id,
    ),
    ['rinviata', 'corrente'],
  )
  assert.equal(isClosed(fixture('iniziata', { state: 'in_progress' })), false)
  assert.equal(isClosed(fixture('confermata', { state: 'open' })), false)
  assert.equal(
    relevantTasks([
      fixture('finita', { state: 'completed' }),
      fixture('annullata', { state: 'cancelled' }),
    ]).length,
    0,
  )
})
