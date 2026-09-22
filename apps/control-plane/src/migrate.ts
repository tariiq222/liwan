import { Pool } from 'pg'
import { getConfig } from './config.js'
import { migrate } from './db.js'

const pool = new Pool({ connectionString: getConfig().databaseUrl })
try { await migrate(pool) } finally { await pool.end() }
