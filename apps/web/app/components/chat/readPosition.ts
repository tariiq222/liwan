/** One monotonic read cursor per context, with one request in flight and bounded failure retry. */
export function createReadPosition(
  write: (id: number) => Promise<unknown>,
  now: () => number = Date.now,
  isCurrent: () => boolean = () => true,
) {
  let acknowledged = 0
  let desired = 0
  let retryAt = 0
  let pending: Promise<void> | null = null
  let disposed = false
  const active = () => !disposed && isCurrent()
  const acknowledge = (id: number): Promise<void> => {
    if (!active()) return Promise.resolve()
    desired = Math.max(desired, id)
    if (pending) return pending
    if (desired <= acknowledged || now() < retryAt) return Promise.resolve()
    pending = (async () => {
      while (active() && desired > acknowledged) {
        const target = desired
        await write(target)
        if (!active()) return
        acknowledged = target
      }
    })().catch(error => { retryAt = now() + 5000; throw error }).finally(() => { pending = null })
    return pending
  }
  acknowledge.dispose = () => { disposed = true; desired = acknowledged }
  return acknowledge
}
