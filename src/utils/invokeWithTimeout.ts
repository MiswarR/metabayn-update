export async function invokeWithTimeout<T>(
  invokeFn: (cmd: string, payload: any) => Promise<T>,
  cmd: string,
  payload: any,
  ms: number
): Promise<T> {
  let tid: any
  let timedOut = false
  const base = invokeFn(cmd, payload)
  const timeout = new Promise<T>((_, reject) => {
    tid = setTimeout(() => {
      timedOut = true
      reject(new Error(`${cmd} timeout`))
    }, ms)
  })

  try {
    return await Promise.race([base, timeout])
  } finally {
    clearTimeout(tid)
    if (timedOut) {
      base.catch(() => {})
    }
  }
}
