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
function rendered(shared: boolean) {
  const args = ['compose', '--env-file', '/dev/null', '-f', 'deploy/docker-compose.yml']
  if (shared) args.push('-f', 'deploy/docker-compose.shared.yml')
  args.push('config', '--format', 'json')
  return JSON.parse(execFileSync('docker', args, { cwd: root, encoding: 'utf8', env: {
    PATH: process.env.PATH, HOME: process.env.HOME, WEBVUE_IMAGE_TAG: 'synthetic', DOMAIN: 'tenant.invalid',
    ODOO_COMMIT: 'synthetic', DB_NAME: 'synthetic', DB_PASSWORD: 'synthetic-not-secret',
    WEBVUE_SHARED_PROXY_TOKEN: 'synthetic-not-a-real-token', WEBVUE_SESSION_KEYS: '{}', WEBVUE_SESSION_ACTIVE_KID: 'test',
    WEBVUE_TENANT_REGISTRY_DIR: '/synthetic/registry', WEBVUE_SHARED_ODOO_CONFIG: '/synthetic/odoo.conf',
  } }))
}
it.skipIf(!hasDocker)('renders dedicated defaults without shared services or build mode', () => {
  const s = rendered(false).services
  expect(s.guard).toBeUndefined()
  expect(s.odoo.command).toEqual(['--workers', '2', '--proxy-mode'])
  expect(s.web.environment.NUXT_ODOO_URL).toBe('http://odoo:8069')
})
it.skipIf(!hasDocker)('renders shared network boundaries, commands, directory mounts and compiled mode', () => {
  const s = rendered(true).services
  for (const name of ['web', 'odoo', 'guard', 'db']) expect(s[name].ports ?? []).toEqual([])
  expect(s.proxy.ports.map((p: { published: string }) => p.published).sort()).toEqual(['443', '80'])
  expect(s.odoo.command ?? []).toEqual([])
  expect(s.odoo.entrypoint).toEqual(['/opt/venv/bin/python', '/opt/webvue/shared/launch_odoo.py'])
  expect(s.odoo.environment.WEBVUE_TENANCY_MODE).toBe('shared')
  expect(Object.keys(s.proxy.networks)).toEqual(['edge'])
  expect(Object.keys(s.web.networks)).toEqual(['guard_web'])
  expect(Object.keys(s.odoo.networks).sort()).toEqual(['database', 'guard_odoo'])
  expect(s.web.build.args.WEBVUE_TENANCY_MODE).toBe('shared')
  expect(s.web.environment.NUXT_ODOO_URL).toBe('http://guard:8080')
  for (const name of ['web', 'guard']) expect(s[name].volumes).toContainEqual(expect.objectContaining({ source: '/synthetic/registry', target: '/etc/webvue', read_only: true }))
  expect(s.odoo.volumes).toContainEqual(expect.objectContaining({ source: '/synthetic/odoo.conf', target: '/etc/odoo/odoo.conf', read_only: true }))
  expect(JSON.stringify(s.web.healthcheck)).not.toContain('/login')
})
function nuxt(mode: string) {
  // The config is evaluated as a plain script, so its ES imports and import.meta are replaced by stubs.
  const source = readFileSync(resolve(root, 'apps/web/nuxt.config.ts'), 'utf8')
    .replace(/^import .*$/gm, '')
    .replaceAll('import.meta.url', "'file:///synthetic/nuxt.config.ts'")
    .replace('export default defineNuxtConfig(', 'globalThis.result = defineNuxtConfig(')
  const context = {
    process: { env: { WEBVUE_TENANCY_MODE: mode, NODE_ENV: 'production' } },
    URL,
    fileURLToPath: (u: URL) => u.pathname,
    discoverLocaleFiles: () => ({ ar: [], en: [] }),
    defineNuxtConfig: (v: unknown) => v,
    result: undefined as any,
  }
  runInNewContext(source, context)
  return context.result
}
it('only removes the seven dedicated proxy rules, keeps the redirects, and enforces same-origin WS in shared compile', () => {
  const dedicated = nuxt('dedicated'); const shared = nuxt('shared')
  // Retired-URL redirects never reach Odoo, so both lanes keep them; only the proxies go.
  const redirects = { '/archived-tasks': { redirect: { to: '/tasks?scope=archived', statusCode: 301 } }, '/reports': { redirect: { to: '/projects/dashboard', statusCode: 301 } } }
  const proxies = Object.entries(dedicated.routeRules).filter(([k]) => !(k in redirects))
  expect(proxies).toHaveLength(7)
  expect(proxies.every(([, v]: [string, any]) => v.proxy)).toBe(true)
  expect(shared.routeRules).toEqual(redirects)
  expect(shared.runtimeConfig.public.wsUrl).toBe('')
  expect(shared.runtimeConfig.odooDb).toBe('')
  expect(shared.nitro.devProxy).toBeUndefined()
  expect(() => nuxt('typo')).toThrow('invalid_tenancy_mode')
})
