import type { Pool } from 'pg'
import { isTransientDatabaseError } from '../db.js'
import { dispatchSharedOnce } from './job-dispatcher.js'
import { runSharedLoop } from './job-loop.js'
import type { SharedFencedAdapter } from './job-worker.js'

/** Explicit composition root for an operator-owned shared worker process.
 * Does not create pools, migrate, install signal handlers or choose an adapter.
 * No production caller is enabled until an effect-fenced adapter is available. */
export async function runSharedWorker(input: {
  pool: Pool
  adapter?: SharedFencedAdapter
  signal: AbortSignal
  wait?: (ms: number) => Promise<void>
  afterDispatch?: () => Promise<void>
}): Promise<void> {
  const { pool, adapter, signal } = input
  if (!adapter) throw new Error('shared_adapter_unavailable')
  const wait = input.wait ?? ((ms: number) => new Promise<void>(resolve => {
    if (signal.aborted) { resolve(); return }
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  }))
  await runSharedLoop({
    dispatch: async () => {
      const result = await dispatchSharedOnce(pool, adapter)
      await input.afterDispatch?.()
      return result
    },
    isStopping: () => signal.aborted,
    isTransient: isTransientDatabaseError,
    wait,
  })
}
