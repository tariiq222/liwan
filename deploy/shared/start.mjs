import { createGuard } from './guard.mjs'
import { readTenantRegistry } from '../../apps/web/server/utils/tenantRegistry.ts'
if (process.env.NASQ_TENANCY_MODE !== 'shared') throw Error('shared_mode_required')
const port = Number(process.env.NASQ_GUARD_PORT ?? 8080)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid_guard_port')
if (Buffer.byteLength(process.env.NASQ_SHARED_PROXY_TOKEN ?? '') < 32) throw Error('invalid_proxy_token')
readTenantRegistry(process.env.NASQ_TENANT_REGISTRY_PATH)
const server = createGuard({
  registryPath: process.env.NASQ_TENANT_REGISTRY_PATH,
  proxyToken: process.env.NASQ_SHARED_PROXY_TOKEN,
  keys: JSON.parse(process.env.NASQ_SESSION_KEYS ?? '{}'),
  activeKid: process.env.NASQ_SESSION_ACTIVE_KID,
  odooUrl: process.env.NASQ_GUARD_ODOO_URL,
  webUrl: process.env.NASQ_GUARD_WEB_URL,
  wsUrl: process.env.NASQ_GUARD_WS_URL,
})
server.listen(port, '0.0.0.0')
