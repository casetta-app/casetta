export type Task = {
  id: string
  owner_user_id: string | null
  home_id: string | null
  title: string
  kind: string
  importance: number
  state:
    | 'open'
    | 'in_progress'
    | 'snoozed'
    | 'completed'
    | 'cancelled'
    | 'needs_verification'
  source: string
  timezone: string
  due_at: string | null
  due_local: string | null
  snoozed_until: string | null
  version: number
}
export const isClosed = (task: Task) =>
  ['completed', 'cancelled'].includes(task.state)
export const attentionAt = (task: Task) => task.snoozed_until ?? task.due_at
export function relevantTasks(tasks: Task[], now = Date.now()) {
  return tasks
    .filter((t) => !isClosed(t))
    .sort((a, b) => {
      const urgency = (t: Task) => {
        if (t.state === 'needs_verification') return 1
        const at = attentionAt(t)
        return at && Date.parse(at) <= now ? 0 : 2
      }
      return (
        urgency(a) - urgency(b) ||
        b.importance - a.importance ||
        (Date.parse(attentionAt(a) ?? '') || Infinity) -
          (Date.parse(attentionAt(b) ?? '') || Infinity) ||
        a.id.localeCompare(b.id)
      )
    })
}
export function formatTaskInstant(instant: string, timezone: string) {
  const date = new Date(instant)
  if (!Number.isFinite(date.getTime()))
    return 'Data non leggibile: aggiorna i dati'
  try {
    return new Intl.DateTimeFormat('it-IT', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(date)
  } catch {
    return `${date.toISOString()} (UTC; fuso non supportato dal dispositivo)`
  }
}
export function taskDate(task: Task) {
  return task.due_at
    ? formatTaskInstant(task.due_at, task.timezone)
    : 'Senza data'
}
export const stateLabels: Record<Task['state'], string> = {
  open: 'Da fare',
  in_progress: 'In corso',
  snoozed: 'Rinviata',
  completed: 'Completata',
  cancelled: 'Annullata',
  needs_verification: 'Prossima data da verificare',
}
