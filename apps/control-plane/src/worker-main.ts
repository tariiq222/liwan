import { Pool } from 'pg'
import { getConfig } from './config.js'
import { attachPoolErrorHandler, isTransientDatabaseError, migrate } from './db.js'
import { claimNext, executeClaimed, expireLeases } from './worker.js'
import { runWorkerLoop } from './worker-loop.js'
import { onShutdownSignal } from './shutdown.js'

const config = getConfig()
const pool = new Pool({ connectionString: config.databaseUrl, max: 5 })
attachPoolErrorHandler(pool)
await migrate(pool)
let stopping = false
// A running operation is never interrupted: the loop claims nothing more and exits when it ends.
onShutdownSignal(() => { stopping = true })

const sleep = async (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
await runWorkerLoop({
  isStopping: () => stopping,
  expire: () => expireLeases(pool),
  claim: () => claimNext(pool),
  execute: (claimed) => executeClaimed(pool, claimed, config),
  isTransient: isTransientDatabaseError,
  wait: sleep,
})
await pool.end()
