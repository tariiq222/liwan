import { createGuard } from './guard.mjs'
import { readTenantRegistry } from '../../apps/web/server/utils/tenantRegistry.ts'
if (process.env.LIWAN_TENANCY_MODE !== 'shared') throw Error('shared_mode_required')
const port = Number(process.env.LIWAN_GUARD_PORT ?? 8080)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid_guard_port')
if (Buffer.byteLength(process.env.LIWAN_SHARED_PROXY_TOKEN ?? '') < 32) throw Error('invalid_proxy_token')
const registryPath = process.env.LIWAN_TENANT_REGISTRY_PATH ?? ''
try {
  readTenantRegistry(registryPath)
} catch (error) {
  if (error.code !== 'tenant_registry_unavailable') throw error
  // Fail closed, but say what happened and how to recover: a stale `.pending` barrier is an operator
  // problem, not a crash. The guard must not start while publication authority is uncertain.
  const barrier = `${registryPath}.pending`
  console.error(`tenant_registry_unavailable: refusing to start while the publication barrier ${barrier} exists; stop every registry publisher, then run on the host: node deploy/shared/registry-recover.mjs --registry ${registryPath} --confirm (it refuses when the registry file may predate a committed change; then, if a crashed publisher left ${registryPath}.publisher-lock, run it with --release-lock --confirm, and recover through the control plane, POST /v1/registry/recover)`)
  process.exit(1)
}
const server = createGuard({
  registryPath,
  // Optional: the control plane's restore registry, served by restore-odoo. Unlike the tenant registry it is not
  // validated at start: an absent or broken file only denies restore hosts, never the guard or the tenants.
  restoreRegistryPath: process.env.LIWAN_RESTORE_REGISTRY_PATH || undefined,
  restoreOdooUrl: process.env.LIWAN_GUARD_RESTORE_ODOO_URL || undefined,
  restoreWsUrl: process.env.LIWAN_GUARD_RESTORE_WS_URL || undefined,
  releaseRoutesDir: process.env.LIWAN_RELEASE_ROUTES_DIR,
  releaseAssetsDir: process.env.LIWAN_RELEASE_ASSETS_DIR,
  proxyToken: process.env.LIWAN_SHARED_PROXY_TOKEN,
  // The LiwanOS public host (host only, no scheme) that serves the payment-done return for customers with no tenant yet.
  prospectHost: process.env.LIWAN_PROSPECT_HOST || undefined,
  keys: JSON.parse(process.env.LIWAN_SESSION_KEYS ?? '{}'),
  activeKid: process.env.LIWAN_SESSION_ACTIVE_KID,
  odooUrl: process.env.LIWAN_GUARD_ODOO_URL,
  webUrl: process.env.LIWAN_GUARD_WEB_URL,
  wsUrl: process.env.LIWAN_GUARD_WS_URL,
})
server.listen(port, '0.0.0.0')

process.once('SIGTERM', () => { server.close() })
process.once('SIGINT', () => { server.close() })
