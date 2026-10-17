import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { ApiErrorSchema } from '@webvue/contracts'
import { tenantRequest, tenantUpstreamHeaders } from '../tenantRequest'
import { installReleaseContext } from '../releaseRequest'
import type { H3Event } from 'h3'

const directories: string[] = []
function temporaryDirectory() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'webvue-ssr-fixture-')))
  directories.push(root)
  return root
}
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true })
})
it('source SSR replay: cookie-only local dispatch fails; validated event identity repairs only local API', async () => {
  const path = join(temporaryDirectory(), 'registry.json')
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


function releaseFixture(mode: 'shared' | 'dedicated') {
  const root = temporaryDirectory()
  const token = 'synthetic-ssr-release-proxy'.repeat(2)
  const host = 'a.example.test'
  const admission = '12345678-1234-1234-1234-123456789abc'
  const route = { schemaVersion: 1, tenantId: 'a', identityRevision: 1, routeRevision: 3, releaseId: 'r1', poolId: 'blue', fence: 5, state: 'serving' }
  writeFileSync(join(root, 'a.json'), JSON.stringify(route))
  writeFileSync(join(root, 'pools.json'), JSON.stringify({ schemaVersion: 1, pools: { blue: { poolId: 'blue', releaseId: 'r1', odooUrl: 'http://127.0.0.1:1', webUrl: 'http://127.0.0.1:2', wsUrl: 'http://127.0.0.1:3' } } }))
  mkdirSync(join(root, 'leases', 'a'), { recursive: true })
  writeFileSync(join(root, 'leases', 'a', `${admission}.json`), JSON.stringify(route))
  const registry = join(root, 'registry.json')
  writeFileSync(registry, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [{ host, tenantId: 'a', database: 'db_a', filestore: 'db_a', enabled: true, registryRevision: 1 }] }))
  vi.stubEnv('WEBVUE_TENANCY_MODE', mode)
  vi.stubEnv('WEBVUE_RELEASE_ROUTES_DIR', root)
  vi.stubEnv('WEBVUE_TENANT_REGISTRY_PATH', registry)
  vi.stubEnv('WEBVUE_SHARED_PROXY_TOKEN', token)
  vi.stubEnv('WEBVUE_DEDICATED_PROXY_TOKEN', token)
  vi.stubEnv('WEBVUE_RELEASE_TENANT_ID', 'a')
  vi.stubEnv('WEBVUE_RELEASE_TENANT_HOST', host)
  vi.stubEnv('WEBVUE_RELEASE_IDENTITY_REVISION', '1')
  vi.stubEnv('WEBVUE_RELEASE_POOL_ID', 'blue')
  const headers: Record<string, string> = { host, cookie: 'session_id=existing-session', 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '1', 'x-webvue-release-pool': 'blue', 'x-webvue-release-revision': '3', 'x-webvue-release-fence': '5', 'x-webvue-release-admission': admission, 'x-webvue-client-ip': '203.0.113.7', 'x-webvue-client-host': host, 'x-webvue-client-proto': 'https' }
  const dispatch = (incoming: Record<string, string>) => {
    const event = { node: { req: { headers: incoming } }, context: {} } as H3Event
    event.context.tenant = tenantRequest(event)
    installReleaseContext(event)
    return { event, upstream: tenantUpstreamHeaders(event) }
  }
  return { headers, dispatch }
}

function sourceApi(headers: Record<string, string>, context: H3Event['context'], dispatch: (headers: Record<string, string>) => unknown) {
  const source = readFileSync(new URL('../../../app/composables/useApi.ts', import.meta.url), 'utf8').replaceAll('import.meta.server', 'true')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports: { useApi?: () => { $api: (path: string) => Promise<unknown> } } = {}
  const fetch = vi.fn(async (url: string, options: { headers: Record<string, string> }) => {
    if (url === '/api/v1/me') dispatch(options.headers)
    return { ok: true }
  })
  new Function('exports', 'require', 'useRequestHeaders', 'useRequestEvent', '$fetch', 'useI18n', js)(exports, () => ({ ApiErrorSchema }), (names: string[]) => Object.fromEntries(names.filter(name => name in headers).map(name => [name, headers[name]])), () => ({ context }), fetch, () => ({ t: (key: string) => key }))
  return { ...exports.useApi!(), fetch }
}

it.each(['shared', 'dedicated'] as const)('actual %s release SSR dispatch keeps the generation pin/admission and private edge fields local', async (mode) => {
  const { headers, dispatch } = releaseFixture(mode)
  const outer = dispatch(headers).event
  if (mode === 'dedicated') {
    // The dedicated tenant resolver deliberately remains null: webvueRelease is the validated SSR authority.
    expect(outer.context.tenant).toBeNull()
    expect(outer.context.webvueRelease?.tenantId).toBe('a')
  }
  const identityOnly = Object.fromEntries(['cookie', 'host', 'x-webvue-proxy-token', 'x-webvue-tenant-revision'].map(name => [name, headers[name]!]))
  expect(() => dispatch(identityOnly)).toThrow()
  let observed: ReturnType<typeof dispatch> | undefined
  const { $api, fetch } = sourceApi(headers, outer.context, incoming => { observed = dispatch(incoming) })
  await expect($api('/api/v1/me')).resolves.toEqual({ ok: true })
  expect(fetch.mock.calls[0]![1].headers).toStrictEqual(headers)
  expect(observed?.event.context.webvueRelease).toMatchObject({ poolId: 'blue', routeRevision: 3, fence: 5, admissionId: headers['x-webvue-release-admission'] })
  expect(observed?.upstream).toMatchObject({ host: headers.host, 'x-webvue-proxy-token': headers['x-webvue-proxy-token'], 'x-webvue-release-pool': 'blue', 'x-webvue-release-revision': '3', 'x-webvue-release-fence': '5', 'x-webvue-release-admission': headers['x-webvue-release-admission'] })
  if (mode === 'dedicated') expect(observed?.upstream).toMatchObject({ 'x-webvue-client-ip': '203.0.113.7', 'x-webvue-client-host': headers.host, 'x-webvue-client-proto': 'https' })
  for (const path of ['https://evil.test/api/v1/me', '//evil.test/api/v1/me', '/api/v1/../auth/login', '/api/v1/%2e%2e/auth', '/other']) {
    await $api(path)
    expect(fetch.mock.calls.at(-1)![1].headers).toStrictEqual({})
  }
})

it('SSR without a validated tenant or release context forwards only its session cookie', async () => {
  const { headers } = releaseFixture('dedicated')
  const { $api, fetch } = sourceApi(headers, {}, () => {})
  await $api('/api/v1/me')
  expect(fetch.mock.calls[0]![1].headers).toStrictEqual({ cookie: headers.cookie })
})
