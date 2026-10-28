import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createGuard } from './guard.mjs'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('guard image includes all runtime import paths and unprivileged native Node24 entrypoint', () => {
  assert.equal(typeof createGuard, 'function')
  const docker = read('Dockerfile')
  assert.match(docker, /FROM node:24\.21\.0-alpine/)
  assert.match(docker, /USER node/)
  for (const file of ['guard.mjs', 'start.mjs', 'healthcheck.mjs']) assert.ok(docker.includes(`deploy/shared/${file}`))
  for (const file of ['tenantRegistry.ts', 'tenantHostResolver.ts']) {
    const path = `../../apps/web/server/utils/${file}`
    assert.ok(existsSync(new URL(path, import.meta.url)))
    assert.ok(docker.includes(`apps/web/server/utils/${file}`))
  }
  assert.match(docker, /HEALTHCHECK.*healthcheck.mjs/)
})
test('shared Odoo selection config never names a default database or trusts forwarding', () => {
  const config = read('odoo.conf')
  assert.match(config, /^dbfilter = \^%h\$$/m)
  assert.match(config, /^proxy_mode = False$/m)
  assert.match(config, /^list_db = False$/m)
  assert.doesNotMatch(config, /^db_name\s*=/m)
})
test('rate module is present in actual proxy build recipe and exactly the declared shared zones are wired', () => {
  const recipe = read('../proxy/Dockerfile')
  assert.match(recipe, /github.com\/mholt\/caddy-ratelimit@v0\.1\.0/)
  assert.match(recipe, /http.handlers.rate_limit/)
  const config = read('Caddyfile')
  const zones = ['webvue_auth', 'webvue_api', 'webvue_public_appointments_ip', 'webvue_public_appointments_path', 'webvue_odoo_image', 'webvue_odoo', 'webvue_web']
  const declared = [...config.matchAll(/^\s*zone\s+(\S+)\s*\{/gm)].map(match => match[1])
  assert.equal(declared.length, zones.length)
  for (const name of zones) assert.equal(declared.filter(zone => zone === name).length, 1, name)
  assert.match(config, /respond @privateToken 403/)
  assert.match(config, /respond @privateRevision 403/)
  assert.match(config, /reverse_proxy guard:8080/)
  assert.doesNotMatch(config, /reverse_proxy (?:odoo|web):/)
  const webZone = config.split('zone webvue_web {')[1].split('}')[0]
  // The built web image serves only /_nuxt/*, /_i18n/* (Nitro route
  // /_i18n/:hash/:locale/messages.json), /fonts/*, /favicon.ico, /robots.txt.
  // There is no /i18n/* route, so it must NOT be exempted (r2 verification).
  for (const p of ['/_nuxt/*', '/_i18n/*', '/fonts/*', '/favicon.ico', '/robots.txt']) {
    assert.ok(webZone.includes(p), `webvue_web must exempt ${p}`)
  }
  assert.ok(!webZone.includes('/i18n/*'), 'webvue_web must not exempt the nonexistent /i18n/* prefix')
})
test('F5 rate matchers: version probe leaves auth, images keep a limited zone, auth stays 20/min', () => {
  const config = read('Caddyfile')
  const zone = n => config.split(`zone webvue_${n} {`)[1].split('\n\t\t\t}')[0]
  assert.match(zone('auth'), /path \/api\/auth\/\* \/api\/v1\/auth\/\* \/web\/session\/\* \/web\/login/)
  assert.match(zone('auth'), /not path \/web\/session\/get_session_info\n/)
  assert.match(zone('auth'), /events 20\n/)
  assert.match(zone('odoo_image'), /path \/web\/image\/\* \/web\/binary\/company_logo/)
  assert.match(zone('odoo_image'), /events 1200\n/)
  assert.match(zone('odoo'), /not path \/web\/session\/\* \/web\/login \/web\/image\/\* \/web\/binary\/company_logo/)
  assert.match(zone('odoo'), /events 600\n/)
  assert.doesNotMatch(config, /\/web\/(?:assets|static|content)/)
})
test('health probe uses only loopback TCP with timeout and fails invalid configuration silently', () => {
  const script = read('healthcheck.mjs')
  assert.match(script, /127\.0\.0\.1/)
  assert.match(script, /setTimeout\(2000\)/)
  assert.doesNotMatch(script, /fetch\(|http\.request|session_id/)
  const result = spawnSync(process.execPath, [new URL('healthcheck.mjs', import.meta.url).pathname], { env: { ...process.env, WEBVUE_GUARD_PORT: 'invalid' }, encoding: 'utf8' })
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '')
})
test('all executable MJS files parse without opening a listener', () => {
  for (const file of ['guard.mjs', 'start.mjs', 'healthcheck.mjs']) {
    const result = spawnSync(process.execPath, ['--check', new URL(file, import.meta.url).pathname], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
})
