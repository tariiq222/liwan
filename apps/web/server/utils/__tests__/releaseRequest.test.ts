import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import http from 'node:http'
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installReleaseContext } from '../releaseRequest'
const servers: http.Server[] = []
const roots: string[] = []
afterEach(() => { for (const server of servers.splice(0)) { server.closeAllConnections(); server.close() }; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs() })
async function fixture(action?: (root: string) => void) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'webvue-release-bff-'))); roots.push(root)
  const route = { schemaVersion: 1, tenantId: 'tenant_a', identityRevision: 3, routeRevision: 2, releaseId: 'r2', poolId: 'green', fence: 2, state: 'serving' }
  writeFileSync(join(root, 'tenant_a.json'), JSON.stringify(route))
  writeFileSync(join(root, 'pools.json'), JSON.stringify({ schemaVersion: 1, pools: { green: { poolId: 'green', releaseId: 'r2', odooUrl: 'http://odoo-green:8069', webUrl: 'http://web-green:3000', wsUrl: 'http://odoo-green:8072', aiUrl: 'http://ai-green:8600', aiStateVersion: '1' } } }))
  vi.stubEnv('WEBVUE_TENANCY_MODE', 'shared'); vi.stubEnv('WEBVUE_RELEASE_ROUTES_DIR', root)
  const app = createApp()
  app.use(defineEventHandler(async event => {
    event.context.tenant = { tenantId: 'tenant_a', registryRevision: 3 }
    installReleaseContext(event)
    if (action) { action(root); return event.context.webvueReleaseWritePermit(async () => ({ wrote: true })) }
    return { poolId: event.context.webvueRelease.poolId, aiMaintenance: event.context.webvueRelease.aiMaintenance }
  }))
  const server = http.createServer(toNodeListener(app)); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  return { root, url: `http://127.0.0.1:${address.port}`, headers: { 'x-webvue-release-pool': 'green', 'x-webvue-release-revision': '2', 'x-webvue-release-fence': '2' } }
}
it('pins a proven tenant request and applies AI-only maintenance without blocking other work', async () => {
  const f = await fixture(); writeFileSync(join(f.root, 'ai.maintenance'), '{}')
  const response = await fetch(f.url, { headers: f.headers })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ poolId: 'green', aiMaintenance: true })
})
it('rejects a forged or retired release generation after tenant proof', async () => {
  const f = await fixture()
  const response = await fetch(f.url, { headers: { ...f.headers, 'x-webvue-release-fence': '1' } })
  expect(response.status).toBe(503)
})
it('rechecks maintenance at actual write admission after the request began', async () => {
  const f = await fixture(root => writeFileSync(join(root, 'tenant_a.maintenance'), '{}'))
  const response = await fetch(f.url, { headers: f.headers })
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('"wrote":true')
})
