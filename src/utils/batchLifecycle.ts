export const BATCH_STATE_KEY = 'metabayn:batchState:v1'

export type BatchFileStatus = 'success' | 'failed' | 'rejected' | 'skipped'

export type BatchStateV1 = {
  version: 1
  running: boolean
  runId: string
  batchKey: string
  completed: Record<string, BatchFileStatus>
  startedAt: number
  updatedAt: number
}

export function loadBatchState(storage: Pick<Storage, 'getItem'> = localStorage): BatchStateV1 | null {
  try {
    const raw = storage.getItem(BATCH_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== 1) return null
    if (typeof parsed.batchKey !== 'string') return null
    if (typeof parsed.running !== 'boolean') return null
    if (typeof parsed.runId !== 'string') return null
    if (!parsed.completed || typeof parsed.completed !== 'object') return null
    return parsed as BatchStateV1
  } catch {
    return null
  }
}

export function saveBatchState(st: BatchStateV1, storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    storage.setItem(BATCH_STATE_KEY, JSON.stringify(st))
  } catch {}
}

export function clearBatchState(storage: Pick<Storage, 'removeItem'> = localStorage) {
  try {
    storage.removeItem(BATCH_STATE_KEY)
  } catch {}
}

export function markBatchInterrupted(
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  nowMs: number = Date.now()
): BatchStateV1 | null {
  const cur = loadBatchState(storage)
  if (!cur) return null
  if (!cur.running) return cur
  const next: BatchStateV1 = { ...cur, running: false, updatedAt: nowMs }
  saveBatchState(next, storage)
  return next
}
