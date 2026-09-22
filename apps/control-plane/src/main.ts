import { Pool } from 'pg'
import { createApp } from './http.js'
import { getConfig } from './config.js'
import { migrate } from './db.js'

const config = getConfig()
const pool = new Pool({ connectionString: config.databaseUrl, max: 10 })
await migrate(pool)
const server = createApp(pool, config)
server.listen(config.port, config.host)
const shutdown = async () => { server.close(); await pool.end() }
process.once('SIGTERM', () => { void shutdown() })
process.once('SIGINT', () => { void shutdown() })
