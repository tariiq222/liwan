import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
const root = resolve(import.meta.dirname, '../../../..')
// These assertions render the Compose model with the real `docker compose`
// CLI. Environments without a Docker client (for example a plain CI step
// container) skip instead of reporting a false regression; GitHub's runner and
// developer machines do exercise them.
const hasDocker = (() => {
  try { execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' }); return true } catch { return false }
})()
function rendered(shared: boolean, extra: readonly string[] = [], env: Readonly<Record<string, string>> = {}) {
  const args = ['compose', '--env-file', '/dev/null', '-f', 'deploy/docker-compose.yml']
  if (shared) args.push('-f', 'deploy/docker-compose.shared.yml')
  args.push(...extra, 'config', '--format', 'json')
  return JSON.parse(execFileSync('docker', args, { cwd: root, encoding: 'utf8', env: {
    PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_CONFIG: process.env.DOCKER_CONFIG,
    LIWAN_IMAGE_TAG: 'synthetic', DOMAIN: 'tenant.invalid',
    ODOO_COMMIT: 'synthetic', DB_NAME: 'synthetic', DB_PASSWORD: 'synthetic-not-secret',
    LIWAN_SHARED_PROXY_TOKEN: 'synthetic-not-a-real-token', LIWAN_SESSION_KEYS: '{}', LIWAN_SESSION_ACTIVE_KID: 'test',
    LIWAN_TENANT_REGISTRY_DIR: '/synthetic/registry', LIWAN_SHARED_ODOO_CONFIG: '/synthetic/odoo.conf',
    ...env,
  } }))
}
it.skipIf(!hasDocker)('renders the TikTok relay on its own internal network when the profile is on', () => {
  const model = rendered(true, ['--profile', 'tiktok'], {
    LIWAN_TIKTOK_CLIENT_SECRET: 'synthetic-not-a-real-secret', LIWAN_TIKTOK_RELAY_HOST: 'tiktok.invalid',
  })
  const relay = model.services['tiktok-relay']
  expect(relay).toBeDefined()
  expect(Object.keys(relay.networks).sort()).toEqual(['edge', 'relay_odoo'])
  // The relay never joins Odoo's own networks: it reaches a tenant through its public origin.
  expect(Object.keys(relay.networks)).not.toContain('guard_odoo')
  expect(Object.keys(relay.networks)).not.toContain('database')
  expect(model.networks.relay_odoo.internal).toBe(true)
  expect(Object.keys(model.services.odoo.networks).sort()).toEqual(['database', 'guard_odoo', 'relay_odoo'])
})
it.skipIf(!hasDocker)('renders dedicated defaults without shared services or build mode', () => {
  const s = rendered(false).services
  expect(s.guard).toBeUndefined()
  expect(s.odoo.command).toEqual(['--workers', '2', '--proxy-mode'])
  expect(s.web.environment.NUXT_ODOO_URL).toBe('http://odoo:8069')
})
it.skipIf(!hasDocker)('renders shared network boundaries, commands, directory mounts and compiled mode', () => {
  const model = rendered(true)
  const s = model.services
  for (const name of ['web', 'odoo', 'guard', 'db']) expect(s[name].ports ?? []).toEqual([])
  expect(s.proxy.ports.map((p: { published: string }) => p.published).sort()).toEqual(['443', '80'])
  expect(s.odoo.command ?? []).toEqual([])
  expect(s.odoo.entrypoint).toEqual(['/opt/venv/bin/python', '/opt/liwan/shared/launch_odoo.py'])
  expect(s.odoo.environment.LIWAN_TENANCY_MODE).toBe('shared')
  expect(Object.keys(s.proxy.networks)).toEqual(['edge'])
  expect(Object.keys(s.web.networks)).toEqual(['guard_web'])
  // `relay_odoo` carries the TikTok relay's binding calls (D13). A stack without the `tiktok` profile
  // runs no relay, so the network stays unused; with the profile the relay joins it and reaches
  // neither `guard_odoo` nor `database`.
  expect(Object.keys(s.odoo.networks).sort()).toEqual(['database', 'guard_odoo', 'relay_odoo'])
  expect(model.networks.relay_odoo.internal).toBe(true)
  expect(s['tiktok-relay']).toBeUndefined()
  expect(s.web.build.args.LIWAN_TENANCY_MODE).toBe('shared')
  expect(s.web.environment.NUXT_ODOO_URL).toBe('http://guard:8080')
  for (const name of ['web', 'guard']) expect(s[name].volumes).toContainEqual(expect.objectContaining({ source: '/synthetic/registry', target: '/etc/liwan', read_only: true }))
  expect(s.odoo.volumes).toContainEqual(expect.objectContaining({ source: '/synthetic/odoo.conf', target: '/etc/odoo/odoo.conf', read_only: true }))
  expect(JSON.stringify(s.web.healthcheck)).not.toContain('/login')
})
it.skipIf(!hasDocker)('declares the restore services the restore runner requires, inert and isolated from the live database', () => {
  // tools/shared_saas_lifecycle/odoo_backup.py selects `--profile restore` and restores into these two services.
  const live = rendered(true)
  expect(live.services['restore-db']).toBeUndefined()
  expect(live.services['restore-odoo']).toBeUndefined()
  const model = rendered(true, ['--profile', 'restore'])
  const s = model.services
  expect(s['restore-db'].image).toBe(s.db.image)
  // Compose renders the tag the odoo service builds; the restore runner compares image ids, so the tag must be shared.
  expect(s['restore-odoo'].image).toBe(s.odoo.image)
  for (const name of ['restore-db', 'restore-odoo']) {
    expect(s[name].profiles).toEqual(['restore'])
    expect(s[name].ports ?? []).toEqual([])
    expect(s[name].cap_drop).toEqual(['ALL'])
    expect(s[name].security_opt).toEqual(['no-new-privileges:true'])
    expect(s[name].healthcheck).toBeDefined()
  }
  // Isolation: restore services share no network with the live db/odoo, and every network they use is internal.
  expect(Object.keys(s['restore-db'].networks)).toEqual(['restore_database'])
  expect(Object.keys(s['restore-odoo'].networks).sort()).toEqual(['guard_restore', 'restore_database'])
  for (const network of ['guard_restore', 'restore_database']) expect(model.networks[network].internal).toBe(true)
  for (const name of ['db', 'odoo']) for (const network of Object.keys(s[name].networks)) expect(Object.keys(s['restore-odoo'].networks)).not.toContain(network)
  const volumes = (name: string) => s[name].volumes.map((v: { source: string }) => v.source)
  expect(volumes('restore-db')).toContain('restore_db_data')
  expect(volumes('restore-db')).not.toContain('db_data')
  expect(volumes('restore-odoo')).toContain('restore_odoo_data')
  expect(volumes('restore-odoo')).not.toContain('odoo_data')
  // Unconfigured, restore-odoo mounts the incomplete reference config that points at restore-db, never the live one.
  expect(s['restore-odoo'].volumes).toContainEqual(expect.objectContaining({ source: resolve(root, 'deploy/shared/odoo.restore.conf'), target: '/etc/odoo/odoo.conf', read_only: true }))
  expect(readFileSync(resolve(root, 'deploy/shared/odoo.restore.conf'), 'utf8')).toMatch(/^db_host = restore-db$/m)
})
it.skipIf(!hasDocker)('mounts the restore registry read-only on the guard and web, and points the guard at restore-odoo', () => {
  const s = rendered(true, [], { LIWAN_RESTORE_REGISTRY_DIR: '/synthetic/restore-registry' }).services
  for (const name of ['guard', 'web']) {
    expect(s[name].volumes).toContainEqual(expect.objectContaining({ source: '/synthetic/restore-registry', target: '/etc/liwan-restore', read_only: true }))
    expect(s[name].environment.LIWAN_RESTORE_REGISTRY_PATH).toBe('/etc/liwan-restore/registry.json')
  }
  // The tenant registry directory stays a separate mount: the two files are never merged.
  expect(s.guard.volumes).toContainEqual(expect.objectContaining({ source: '/synthetic/registry', target: '/etc/liwan', read_only: true }))
  expect(s.guard.environment.LIWAN_GUARD_RESTORE_ODOO_URL).toBe('http://restore-odoo:8069')
  expect(s.guard.environment.LIWAN_GUARD_RESTORE_WS_URL).toBe('http://restore-odoo:8072')
  expect(Object.keys(s.guard.networks)).toContain('guard_restore')
})
function nuxt(mode: string) {
  // The config is evaluated as a plain script, so its ES imports and import.meta are replaced by stubs.
  const source = readFileSync(resolve(root, 'apps/web/nuxt.config.ts'), 'utf8')
    .replace(/^import .*$/gm, '')
    .replaceAll('import.meta.url', "'file:///synthetic/nuxt.config.ts'")
    .replace('export default defineNuxtConfig(', 'globalThis.result = defineNuxtConfig(')
  const context = {
    process: { env: { LIWAN_TENANCY_MODE: mode, NODE_ENV: 'production' } },
    URL,
    fileURLToPath: (u: URL) => u.pathname,
    discoverLocaleFiles: () => ({ ar: [], en: [] }),
    defineNuxtConfig: (v: unknown) => v,
    result: undefined as any,
  }
  runInNewContext(source, context)
  return context.result
}
it('only removes the dedicated /web proxy rule, keeps the redirects, and enforces same-origin WS in shared compile', () => {
  const dedicated = nuxt('dedicated'); const shared = nuxt('shared')
  // Retired-URL redirects never reach Odoo, so both lanes keep them; only the proxies go.
  const redirects = { '/archived-tasks': { redirect: { to: '/tasks?scope=archived', statusCode: 301 } }, '/reports': { redirect: { to: '/projects/dashboard', statusCode: 301 } } }
  // The public pay, booking, invitation and password-reset pages carry a token in their address; both lanes keep their security headers.
  const tokenPage = { headers: { 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' } }
  const security = { '/pay/**': tokenPage, '/book/**': tokenPage, '/join': tokenPage, '/reset-password': tokenPage }
  const kept = { ...redirects, ...security }
  const proxies = Object.entries(dedicated.routeRules).filter(([k]) => !(k in kept))
  expect(proxies.map(([path]) => path)).toEqual(['/web/**'])
  expect(proxies.every(([, v]: [string, any]) => v.proxy)).toBe(true)
  expect(shared.routeRules).toEqual(kept)
  expect(shared.runtimeConfig.public.wsUrl).toBe('')
  expect(shared.runtimeConfig.odooDb).toBe('')
  expect(shared.nitro.devProxy).toBeUndefined()
  expect(() => nuxt('typo')).toThrow('invalid_tenancy_mode')
})
