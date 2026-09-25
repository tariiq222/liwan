import { Pool } from 'pg'
import { getConfig } from './config.js'
import { attachPoolErrorHandler, isTransientDatabaseError, migrate } from './db.js'
import { claimNext, executeClaimed, expireLeases } from './worker.js'
import { runWorkerLoop } from './worker-loop.js'

const config = getConfig()
const pool = new Pool({ connectionString: config.databaseUrl, max: 5 })
attachPoolErrorHandler(pool)
await migrate(pool)
let stopping = false
process.once('SIGTERM', () => { stopping = true })
process.once('SIGINT', () => { stopping = true })

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
