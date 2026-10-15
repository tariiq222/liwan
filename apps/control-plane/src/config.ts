import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'

export type Config = {
  customerCommercialIssuer?: string
  customerCommercialServiceKey?: string
  sharedRuntimeConfigPath?: string
  /** Authenticated internal channel between control-api (caller) and control-worker (executor) for the admin password effect. */
  internalEffect?: { key: string; url?: string; ca?: Buffer; host?: string; port?: number; tls?: { key: Buffer; cert: Buffer } }
  installationId: string
  key: string
  inventoryPath: string
  managedInventoryPath?: string
  tenantRegistryPath?: string
  stateDir: string
  repositoryRoot: string
  python: string
  invokeAdapter?: (invocation: import('./worker.js').OperatorInvocation) => Promise<{ code: number; receipt: Record<string, unknown> }>
}

export function getConfig(): Config & { databaseUrl: string; host: string; port: number; tls?: { key: Buffer; cert: Buffer } } {
  const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value }
  const installationId = required('CONTROL_INSTALLATION_ID')
  const key = required('CONTROL_SERVICE_KEY')
  if (Buffer.byteLength(key) < 32) throw new Error('CONTROL_SERVICE_KEY must contain at least 32 bytes')
  const customerCommercialIssuer = process.env.CUSTOMER_COMMERCIAL_ISSUER
  const customerCommercialServiceKey = process.env.CUSTOMER_COMMERCIAL_SERVICE_KEY
  if (customerCommercialServiceKey && (Buffer.byteLength(customerCommercialServiceKey) < 32 || customerCommercialServiceKey === key)) throw new Error('CUSTOMER_COMMERCIAL_SERVICE_KEY must be distinct and contain at least 32 bytes')
  if (customerCommercialIssuer && customerCommercialIssuer === installationId) throw new Error('CUSTOMER_COMMERCIAL_ISSUER must be distinct from vendor issuer')
  const internalEffect = internalEffectConfig(key, customerCommercialServiceKey)
  const inventoryPath = required('NASQ_CLI_INVENTORY')
  const managedInventoryPath = process.env.NASQ_MANAGED_INVENTORY
  const sharedRuntimeConfigPath = process.env.NASQ_SHARED_RUNTIME_CONFIG
  const tenantRegistryPath = process.env.NASQ_TENANT_REGISTRY_PATH
  const stateDir = required('NASQ_CLI_STATE_DIR')
  const repositoryRoot = required('NASQ_REPOSITORY_ROOT')
  for (const path of [inventoryPath, managedInventoryPath, tenantRegistryPath, sharedRuntimeConfigPath, stateDir, repositoryRoot]) if (path && !isAbsolute(path)) throw new Error('operator paths must be absolute')
  const host = process.env.CONTROL_HOST ?? '127.0.0.1'
  const port = Number(process.env.CONTROL_PORT ?? '4179')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid CONTROL_PORT')
  const tlsKey = process.env.CONTROL_TLS_KEY
  const tlsCert = process.env.CONTROL_TLS_CERT
  if ((host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') && (!tlsKey || !tlsCert)) throw new Error('HTTPS is required outside loopback')
  return { installationId, key, customerCommercialIssuer, customerCommercialServiceKey, ...(sharedRuntimeConfigPath ? { sharedRuntimeConfigPath } : {}), ...(internalEffect ? { internalEffect } : {}), inventoryPath, managedInventoryPath, ...(tenantRegistryPath ? { tenantRegistryPath } : {}), stateDir, repositoryRoot, python: process.env.NASQ_CLI_PYTHON ?? 'python3', databaseUrl: required('CONTROL_DATABASE_URL'), host, port,
    tls: tlsKey && tlsCert ? { key: readFileSync(tlsKey), cert: readFileSync(tlsCert) } : undefined }
}

/** The key makes the channel exist; it must be its own secret so a leaked vendor or customer key cannot call it.
 * Caller side needs URL+CA, executor side needs HOST+TLS key+cert; TLS is never optional. Unset key = channel off. */
function internalEffectConfig(controlKey: string, customerKey: string | undefined): Config['internalEffect'] {
  const key = process.env.INTERNAL_EFFECT_KEY
  if (!key) return undefined
  if (Buffer.byteLength(key) < 32 || key === controlKey || key === customerKey) throw new Error('INTERNAL_EFFECT_KEY must be distinct and contain at least 32 bytes')
  const url = process.env.INTERNAL_EFFECT_URL
  const caPath = process.env.INTERNAL_EFFECT_CA
  const host = process.env.INTERNAL_EFFECT_HOST
  const tlsKey = process.env.INTERNAL_EFFECT_TLS_KEY
  const tlsCert = process.env.INTERNAL_EFFECT_TLS_CERT
  const result: NonNullable<Config['internalEffect']> = { key }
  if (url || caPath) {
    if (!url || !caPath || !isAbsolute(caPath) || new URL(url).protocol !== 'https:') throw new Error('INTERNAL_EFFECT_URL must be https and requires an absolute INTERNAL_EFFECT_CA')
    result.url = url
    result.ca = readFileSync(caPath)
  }
  if (host) {
    const port = Number(process.env.INTERNAL_EFFECT_PORT ?? '4188')
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid INTERNAL_EFFECT_PORT')
    if (!tlsKey || !tlsCert || !isAbsolute(tlsKey) || !isAbsolute(tlsCert)) throw new Error('HTTPS is required for INTERNAL_EFFECT_HOST')
    result.host = host
    result.port = port
    result.tls = { key: readFileSync(tlsKey), cert: readFileSync(tlsCert) }
  }
  return result
}
