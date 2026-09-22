import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'

export type Config = {
  installationId: string
  key: string
  inventoryPath: string
  stateDir: string
  repositoryRoot: string
  python: string
}

export function getConfig(): Config & { databaseUrl: string; host: string; port: number; tls?: { key: Buffer; cert: Buffer } } {
  const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value }
  const installationId = required('CONTROL_INSTALLATION_ID')
  const key = required('CONTROL_SERVICE_KEY')
  if (Buffer.byteLength(key) < 32) throw new Error('CONTROL_SERVICE_KEY must contain at least 32 bytes')
  const inventoryPath = required('NASQ_CLI_INVENTORY')
  const stateDir = required('NASQ_CLI_STATE_DIR')
  const repositoryRoot = required('NASQ_REPOSITORY_ROOT')
  for (const path of [inventoryPath, stateDir, repositoryRoot]) if (!isAbsolute(path)) throw new Error('operator paths must be absolute')
  const host = process.env.CONTROL_HOST ?? '127.0.0.1'
  const port = Number(process.env.CONTROL_PORT ?? '4179')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid CONTROL_PORT')
  const tlsKey = process.env.CONTROL_TLS_KEY
  const tlsCert = process.env.CONTROL_TLS_CERT
  if ((host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') && (!tlsKey || !tlsCert)) throw new Error('HTTPS is required outside loopback')
  return { installationId, key, inventoryPath, stateDir, repositoryRoot, python: process.env.NASQ_CLI_PYTHON ?? 'python3', databaseUrl: required('CONTROL_DATABASE_URL'), host, port,
    tls: tlsKey && tlsCert ? { key: readFileSync(tlsKey), cert: readFileSync(tlsCert) } : undefined }
}
