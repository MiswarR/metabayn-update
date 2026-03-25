import { describe, expect, it, vi } from 'vitest'
import { invokeWithTimeout } from './invokeWithTimeout'

describe('invokeWithTimeout', () => {
  it('mengembalikan hasil jika invoke selesai sebelum timeout', async () => {
    vi.useFakeTimers()
    const invokeFn = vi.fn(async () => {
      await new Promise<void>((r) => setTimeout(r, 10))
      return 'ok'
    })

    const p = invokeWithTimeout(invokeFn, 'cmd', { a: 1 }, 100)
    vi.advanceTimersByTime(10)
    await vi.runAllTicks()
    await expect(p).resolves.toBe('ok')
    expect(invokeFn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('reject timeout dan tidak memicu unhandled rejection dari promise asli', async () => {
    vi.useFakeTimers()
    const unhandled: any[] = []
    const handler = (reason: any) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', handler)

    const invokeFn = vi.fn(() => {
      return new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('late reject')), 50)
      })
    })

    const p = invokeWithTimeout(invokeFn, 'cmd', {}, 10)
    vi.advanceTimersByTime(10)
    await expect(p).rejects.toThrow(/timeout/i)

    vi.advanceTimersByTime(100)
    await vi.runAllTicks()
    await Promise.resolve()

    process.off('unhandledRejection', handler)
    expect(unhandled.length).toBe(0)
    vi.useRealTimers()
  })
})
