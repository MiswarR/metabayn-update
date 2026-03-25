import { describe, expect, it } from 'vitest'
import { BATCH_STATE_KEY, clearBatchState, loadBatchState, markBatchInterrupted, saveBatchState, type BatchStateV1 } from './batchLifecycle'

function createMemStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial }
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null
    },
    setItem(key: string, value: string) {
      data[key] = value
    },
    removeItem(key: string) {
      delete data[key]
    },
    dump() {
      return { ...data }
    }
  }
}

describe('batchLifecycle', () => {
  it('loadBatchState mengembalikan null jika tidak ada state', () => {
    const storage = createMemStorage()
    expect(loadBatchState(storage)).toBeNull()
  })

  it('markBatchInterrupted mematikan running dan menjaga progress', () => {
    const st: BatchStateV1 = {
      version: 1,
      running: true,
      runId: 'run-1',
      batchKey: 'key-1',
      completed: { 'a.jpg': 'success', 'b.jpg': 'failed' },
      startedAt: 10,
      updatedAt: 20
    }
    const storage = createMemStorage()
    saveBatchState(st, storage)

    const next = markBatchInterrupted(storage, 999)
    expect(next?.running).toBe(false)
    expect(next?.updatedAt).toBe(999)
    expect(next?.completed).toEqual({ 'a.jpg': 'success', 'b.jpg': 'failed' })

    const loaded = loadBatchState(storage)
    expect(loaded?.running).toBe(false)
    expect(loaded?.updatedAt).toBe(999)
  })

  it('clearBatchState menghapus state', () => {
    const storage = createMemStorage({ [BATCH_STATE_KEY]: JSON.stringify({ version: 1 }) })
    clearBatchState(storage)
    expect(storage.getItem(BATCH_STATE_KEY)).toBeNull()
  })
})
