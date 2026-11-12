import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = readFileSync(new URL('../../apps/web/app/composables/useApi.ts', import.meta.url), 'utf8')
const secret = 'synthetic-private-hop-token'
const incoming = { cookie: 'session_id=synthetic', host: 'tenant.acceptance.test', 'x-liwan-proxy-token': secret, 'x-liwan-tenant-revision': '7' }
function replay(server, trusted, loadedMe = null) {
  const js = ts.transpileModule(source.replaceAll('import.meta.server', String(server)), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}, calls = []
  new Function('exports', 'require', 'useRequestHeaders', 'useRequestEvent', 'useI18n', 'useNuxtData', '$fetch', js)(exports, () => ({ ApiErrorSchema: { safeParse: () => ({ success: false }) }, captureSessionQueryOwner: () => () => () => true, contentDispositionFilename: () => null }), names => Object.fromEntries(names.filter(n => n in incoming).map(n => [n, incoming[n]])), () => ({ context: { tenant: trusted ? {} : null } }), () => ({ t: key => key, te: () => false, locale: { value: 'ar' } }), () => ({ data: { value: loadedMe } }), Object.assign(async (path, options) => { calls.push({ path, options }); return { ok: true } }, { raw: async (path, options) => { calls.push({ path, options }); return { _data: null, headers: new Headers() } } }))
  return { api: exports.useApi(), calls }
}
test('source SSR replay trusted local paths only; no external/traversal/encoded token leakage', async () => {
  const { api, calls } = replay(true, true)
  for (const path of ['/api/v1/me', '/api/v1/tasks/1', '/api/v1/reports/projects/summary']) { await api.$api(path); assert.deepEqual(calls.at(-1).options.headers, incoming) }
  for (const path of ['https://evil.test/api/v1/me', '//evil.test/api/v1/me', '/api/v1/../auth/login', '/api/v1/%2e%2e/auth', '/api/v1/a%2fb', '/api/v1/a%5cb', '/api/v1/a\\b', '/api/v1/me?db=x', '/api/v1/me#fragment', '/other']) { await api.$api(path); assert.deepEqual(calls.at(-1).options.headers, {}) }
  for (const path of ['/api/v1/hr/payroll/runs/1/bank-file']) { await api.$download(path); assert.deepEqual(calls.at(-1).options.headers, incoming) }
  for (const path of ['https://evil.test/api/v1/me', '/api/v1/../auth/login', '/api/v1/%2e%2e/auth', '/api/v1/me?db=x', '/api/v1/me#fragment']) { await api.$download(path); assert.deepEqual(calls.at(-1).options.headers, {}) }
  assert.deepEqual(Object.keys(api), ['$api', '$download']); assert.ok(!JSON.stringify(api).includes(secret))
})
test('client replay never acquires identity; unvalidated server context never forwards private binding', async () => {
  const client = replay(false, true); await client.api.$api('/api/v1/me'); assert.deepEqual(client.calls[0].options.headers, {})
  const untrusted = replay(true, false); await untrusted.api.$api('/api/v1/me'); assert.deepEqual(untrusted.calls[0].options.headers, { cookie: incoming.cookie })
})
test('a loaded identity states its company on trusted paths only', async () => {
  const { api, calls } = replay(true, true, { company: { id: 7 } })
  await api.$api('/api/v1/tasks/1'); assert.deepEqual(calls.at(-1).options.headers, { ...incoming, 'X-Liwan-Expected-Company-Id': '7' })
  await api.$download('/api/v1/hr/payroll/runs/1/bank-file'); assert.deepEqual(calls.at(-1).options.headers, { ...incoming, 'X-Liwan-Expected-Company-Id': '7' })
  for (const path of ['https://evil.test/api/v1/me', '//evil.test/api/v1/me', '/api/v1/../auth/login', '/other']) { await api.$api(path); assert.deepEqual(calls.at(-1).options.headers, {}) }
})
