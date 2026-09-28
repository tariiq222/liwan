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
test('rate module is present in actual proxy build recipe and all four shared zones are wired', () => {
  const recipe = read('../proxy/Dockerfile')
  assert.match(recipe, /github.com\/mholt\/caddy-ratelimit@v0\.2\.0/)
  assert.match(recipe, /http.handlers.rate_limit/)
  const config = read('Caddyfile')
  for (const name of ['auth', 'api', 'odoo', 'web']) assert.equal(config.split(`zone nasq_${name} {`).length, 2)
  assert.match(config, /respond @privateToken 403/)
  assert.match(config, /respond @privateRevision 403/)
  assert.match(config, /reverse_proxy guard:8080/)
  assert.doesNotMatch(config, /reverse_proxy (?:odoo|web):/)
})
test('health probe uses only loopback TCP with timeout and fails invalid configuration silently', () => {
  const script = read('healthcheck.mjs')
  assert.match(script, /127\.0\.0\.1/)
  assert.match(script, /setTimeout\(2000\)/)
  assert.doesNotMatch(script, /fetch\(|http\.request|session_id/)
  const result = spawnSync(process.execPath, [new URL('healthcheck.mjs', import.meta.url).pathname], { env: { ...process.env, NASQ_GUARD_PORT: 'invalid' }, encoding: 'utf8' })
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '')
})
test('all executable MJS files parse without opening a listener', () => {
  for (const file of ['guard.mjs', 'start.mjs', 'healthcheck.mjs']) {
    const result = spawnSync(process.execPath, ['--check', new URL(file, import.meta.url).pathname], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
})
