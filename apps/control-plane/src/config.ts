import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { normalizeEmail } from './admin-auth/accounts.js'

export type AdminConfig = { secretKey: Buffer; rpId: string; origin: string; rpName: 'WebVue'; /** Development only: the one account the dev sign-in routes may open. */ devLoginEmail?: string }

export type Config = {
  admin?: AdminConfig
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
  const admin = adminConfig(process.env)
  const inventoryPath = required('WEBVUE_CLI_INVENTORY')
  const managedInventoryPath = process.env.WEBVUE_MANAGED_INVENTORY
  const sharedRuntimeConfigPath = process.env.WEBVUE_SHARED_RUNTIME_CONFIG
  const tenantRegistryPath = process.env.WEBVUE_TENANT_REGISTRY_PATH
  const stateDir = required('WEBVUE_CLI_STATE_DIR')
  const repositoryRoot = required('WEBVUE_REPOSITORY_ROOT')
  for (const path of [inventoryPath, managedInventoryPath, tenantRegistryPath, sharedRuntimeConfigPath, stateDir, repositoryRoot]) if (path && !isAbsolute(path)) throw new Error('operator paths must be absolute')
  const host = process.env.CONTROL_HOST ?? '127.0.0.1'
  const port = Number(process.env.CONTROL_PORT ?? '4179')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid CONTROL_PORT')
  const tlsKey = process.env.CONTROL_TLS_KEY
  const tlsCert = process.env.CONTROL_TLS_CERT
  if (!isLoopbackHost(host) && (!tlsKey || !tlsCert)) throw new Error('HTTPS is required outside loopback')
  return { installationId, key, customerCommercialIssuer, customerCommercialServiceKey, ...(sharedRuntimeConfigPath ? { sharedRuntimeConfigPath } : {}), ...(internalEffect ? { internalEffect } : {}), ...(admin ? { admin } : {}), inventoryPath, managedInventoryPath, ...(tenantRegistryPath ? { tenantRegistryPath } : {}), stateDir, repositoryRoot, python: process.env.WEBVUE_CLI_PYTHON ?? 'python3', databaseUrl: required('CONTROL_DATABASE_URL'), host, port,
    tls: tlsKey && tlsCert ? { key: readFileSync(tlsKey), cert: readFileSync(tlsCert) } : undefined }
}

/** Vendor admin sign-in is off without ADMIN_SECRET_KEY. Its secret must be its own key, never a service key. */
export function adminConfig(env: Record<string, string | undefined>): AdminConfig | undefined {
  const secret = env.ADMIN_SECRET_KEY
  if (!secret) return undefined
  if (Buffer.byteLength(secret) < 32) throw new Error('ADMIN_SECRET_KEY must contain at least 32 bytes')
  for (const other of [env.CONTROL_SERVICE_KEY, env.CUSTOMER_COMMERCIAL_SERVICE_KEY, env.INTERNAL_EFFECT_KEY]) if (other && other === secret) throw new Error('ADMIN_SECRET_KEY must be distinct from every service key')
  const rpId = env.ADMIN_RP_ID ?? ''
  if (!/^[a-z0-9.-]{1,253}$/.test(rpId)) throw new Error('ADMIN_RP_ID is required')
  let origin: URL
  try { origin = new URL(env.ADMIN_ORIGIN ?? '') } catch { throw new Error('ADMIN_ORIGIN is required') }
  const loopback = rpId === 'localhost' && origin.hostname === 'localhost'
  if (origin.hostname !== rpId || (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:')) || origin.pathname !== '/' || origin.search) throw new Error('ADMIN_ORIGIN must be the https origin of ADMIN_RP_ID')
  const devLoginEmail = devLoginEmailConfig(env, origin)
  return { secretKey: Buffer.from(secret), rpId, origin: origin.origin, rpName: 'WebVue', ...(devLoginEmail ? { devLoginEmail } : {}) }
}

/** A host name or address of this machine (a bracketed IPv6 literal from a URL is accepted). */
export const isLoopbackHost = (host: string): boolean => ['127.0.0.1', '::1', 'localhost'].includes(host.replace(/^\[(.*)\]$/, '$1'))

/** The developer sign-in skips every credential, so it exists only for a loopback http origin on a loopback bind outside production. */
function devLoginEmailConfig(env: Record<string, string | undefined>, origin: URL): string | undefined {
  if (!env.ADMIN_DEV_LOGIN_EMAIL) return undefined
  // adminConfig lets an http origin through only for localhost, so the protocol alone makes it loopback.
  if (origin.protocol !== 'http:') throw new Error('ADMIN_DEV_LOGIN_EMAIL requires an http loopback ADMIN_ORIGIN')
  if (!isLoopbackHost(env.CONTROL_HOST ?? '127.0.0.1')) throw new Error('ADMIN_DEV_LOGIN_EMAIL requires a loopback CONTROL_HOST')
  if (env.NODE_ENV === 'production') throw new Error('ADMIN_DEV_LOGIN_EMAIL is not allowed when NODE_ENV is production')
  try { return normalizeEmail(env.ADMIN_DEV_LOGIN_EMAIL) } catch { throw new Error('ADMIN_DEV_LOGIN_EMAIL must be an email address') }
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
