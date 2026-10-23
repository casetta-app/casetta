import { supabase } from '../lib/supabase'
import type { Task } from './model'
export type TaskCommand = {
  key: string
  rpc: 'create_domestic_task' | 'act_on_domestic_task'
  args: Record<string, string | number | null>
}
export async function loadTasks(
  user: string,
  home: string | null,
): Promise<Task[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    let query = supabase!.from('domestic_tasks').select('*')
    query = home
      ? query.or(`owner_user_id.eq.${user},home_id.eq.${home}`)
      : query.eq('owner_user_id', user)
    const { data, error } = await query
      .order('created_at')
      .abortSignal(controller.signal)
    if (error) throw error
    return (data ?? []) as Task[]
  } finally {
    clearTimeout(timer)
  }
}
export async function executeTask(command: TaskCommand) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const { error } = await supabase!
      .rpc(command.rpc, { ...command.args, p_key: command.key })
      .abortSignal(controller.signal)
    if (error) throw error
  } finally {
    clearTimeout(timer)
  }
}
export const pendingKey = (user: string, home: string | null) =>
  `casetta:task-command:${user}:${home ?? 'personal'}`
export function persistCommand(key: string, command: TaskCommand) {
  // Fail before sending if a durable retry key cannot be preserved.
  localStorage.setItem(key, JSON.stringify(command))
}
export function restoreCommand(key: string): TaskCommand | null {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  const value = JSON.parse(raw) as TaskCommand
  if (
    !value ||
    !['create_domestic_task', 'act_on_domestic_task'].includes(value.rpc) ||
    typeof value.key !== 'string' ||
    !value.args ||
    typeof value.args !== 'object'
  )
    throw Error('Comando locale non leggibile. Non è stato inviato.')
  return value
}
export function taskError(error: unknown) {
  const code = (error as { code?: string })?.code
  if (code === '40001')
    return 'Attività modificata da un’altra operazione. Ricarica e verifica lo stato prima di riprovare.'
  if (code === '42501')
    return 'Accesso non consentito o revocato. Nessuna autorizzazione deriva dal dispositivo.'
  if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205')
    return 'Attività non ancora attivate sul database: applicare la migrazione R1-A dopo revisione.'
  return error instanceof Error
    ? error.message
    : (error as { message?: string })?.message ||
        'Operazione non confermata. Controlla la rete e riprova con la stessa richiesta.'
}
