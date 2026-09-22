import { Pool } from 'pg'
import { getConfig } from './config.js'
import { migrate } from './db.js'
import { claimNext, executeClaimed, expireLeases } from './worker.js'

const config = getConfig()
const pool = new Pool({ connectionString: config.databaseUrl, max: 5 })
await migrate(pool)
let stopping = false
process.once('SIGTERM', () => { stopping = true })
process.once('SIGINT', () => { stopping = true })
while (!stopping) {
  await expireLeases(pool)
  const claimed = await claimNext(pool)
  if (claimed) await executeClaimed(pool, claimed, config)
  else await new Promise((resolve) => setTimeout(resolve, 1000))
}
await pool.end()
