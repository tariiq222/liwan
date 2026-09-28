import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = readFileSync(new URL('../../apps/web/app/composables/useApi.ts', import.meta.url), 'utf8')
const secret = 'synthetic-private-hop-token'
const incoming = { cookie: 'session_id=synthetic', host: 'tenant.acceptance.test', 'x-nasq-proxy-token': secret, 'x-nasq-tenant-revision': '7' }
function replay(server, trusted) {
  const js = ts.transpileModule(source.replaceAll('import.meta.server', String(server)), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}, calls = []
  new Function('exports', 'require', 'useRequestHeaders', 'useRequestEvent', '$fetch', js)(exports, () => ({ ApiErrorSchema: {} }), names => Object.fromEntries(names.map(n => [n, incoming[n]])), () => ({ context: { tenant: trusted ? {} : null } }), async (path, options) => { calls.push({ path, options }); return { ok: true } })
  return { api: exports.useApi(), calls }
}
test('source SSR replay trusted local paths only; no external/traversal/encoded token leakage', async () => {
  const { api, calls } = replay(true, true)
  for (const path of ['/api/v1/me', '/api/v1/tasks/1', '/api/v1/reports/projects']) { await api.$api(path); assert.deepEqual(calls.at(-1).options.headers, incoming) }
  for (const path of ['https://evil.test/api/v1/me', '//evil.test/api/v1/me', '/api/v1/../auth/login', '/api/v1/%2e%2e/auth', '/api/v1/a%2fb', '/api/v1/a%5cb', '/api/v1/a\\b', '/api/v1/me?db=x', '/api/v1/me#fragment', '/other']) { await api.$api(path); assert.deepEqual(calls.at(-1).options.headers, {}) }
  assert.deepEqual(Object.keys(api), ['$api']); assert.ok(!JSON.stringify(api).includes(secret))
})
test('client replay never acquires identity; unvalidated server context never forwards private binding', async () => {
  const client = replay(false, true); await client.api.$api('/api/v1/me'); assert.deepEqual(client.calls[0].options.headers, {})
  const untrusted = replay(true, false); await untrusted.api.$api('/api/v1/me'); assert.deepEqual(untrusted.calls[0].options.headers, { cookie: incoming.cookie })
})
