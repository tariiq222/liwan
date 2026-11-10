import { Pool } from 'pg'
import { createApp } from './http.js'
import { getConfig } from './config.js'
import { attachPoolErrorHandler, migrate } from './db.js'
import { syncProviderFile } from './ai-provider/sync.js'

const config = getConfig()
const pool = new Pool({ connectionString: config.databaseUrl, max: 10 })
attachPoolErrorHandler(pool)
await migrate(pool)
await syncProviderFile(pool, config)
const server = createApp(pool, config)
server.on('error', () => { console.error('[control-plane] HTTP server error') })
server.listen(config.port, config.host)
const shutdown = async () => { server.close(); await pool.end() }
process.once('SIGTERM', () => { void shutdown() })
process.once('SIGINT', () => { void shutdown() })
