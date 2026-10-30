// Local TCP liveness ONLY. No tenant, registry, session or database is selected.
// Not readiness: upstream connectivity and isolation require separate acceptance.
import { createConnection } from 'node:net'
const port = Number(process.env.LIWAN_GUARD_PORT ?? 8080)
if (!Number.isInteger(port) || port < 1 || port > 65535) process.exit(1)
const socket = createConnection({ host: '127.0.0.1', port })
socket.setTimeout(2000)
socket.once('connect', () => { socket.destroy(); process.exit(0) })
socket.once('timeout', () => { socket.destroy(); process.exit(1) })
socket.once('error', () => process.exit(1))
