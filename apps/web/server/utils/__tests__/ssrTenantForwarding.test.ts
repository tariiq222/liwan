import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { ApiErrorSchema } from '@webvue/contracts'
import { tenantRequest } from '../tenantRequest'

afterEach(() => vi.unstubAllEnvs())
it('source SSR replay: cookie-only local dispatch fails; validated event identity repairs only local API', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'webvue-ssr-fixture-')), 'registry.json')
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [{ host: 'a.example.test', tenantId: 'a', database: 'db_a', filestore: 'db_a', enabled: true, registryRevision: 1 }] }))
  vi.stubEnv('WEBVUE_TENANCY_MODE', 'shared'); vi.stubEnv('WEBVUE_TENANT_REGISTRY_PATH', path)
  const token = 'synthetic-token'.repeat(4); vi.stubEnv('WEBVUE_SHARED_PROXY_TOKEN', token)
  const headers: Record<string, string> = { host: 'a.example.test', 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '1', cookie: 'session_id=envelope' }
  const event = (h: Record<string, string>) => ({ node: { req: { headers: h } } }) as never
  // Exact pre-fix cookie-only shape (Nitro transport itself is not mocked as proven).
  expect(() => tenantRequest(event({ cookie: headers.cookie! }))).toThrow('tenant_boundary_rejected')
  const tenant = tenantRequest(event(headers))
  const source = readFileSync(new URL('../../../app/composables/useApi.ts', import.meta.url), 'utf8').replaceAll('import.meta.server', 'true')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports: any = {}
  const fetch = vi.fn(async (_url: string, options: { headers: Record<string, string> }) => {
    if (_url.startsWith('/api/v1/')) tenantRequest(event(options.headers))
    return { ok: true }
  })
  new Function('exports', 'require', 'useRequestHeaders', 'useRequestEvent', '$fetch', 'useI18n', js)(exports, () => ({ ApiErrorSchema }), (names: string[]) => Object.fromEntries(names.map(n => [n, headers[n]])), () => ({ context: { tenant } }), fetch, () => ({ t: (key: string) => key }))
  const { $api } = exports.useApi()
  await expect($api('/api/v1/me')).resolves.toEqual({ ok: true })
  expect(fetch.mock.calls[0]![1].headers).toEqual(headers)
  for (const url of ['https://evil.test/api/v1/me', '//evil.test/api/v1/me', '/api/v1/../auth/login', '/api/v1/%2e%2e/auth', '/other']) {
    // Capture external calls without dispatch, assert zero secret/cookie forwarding.
    fetch.mockResolvedValueOnce({ ok: true })
    await $api(url)
    expect(fetch.mock.calls.at(-1)![1].headers).toEqual({})
  }
})
