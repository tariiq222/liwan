import { afterEach, describe, expect, it, vi } from 'vitest'

type Hook = (...args: any[]) => unknown
type Sent = [unknown, [{ type: string }, Record<string, any>][]]

const sent: Sent[] = []
const startSpy = vi.fn()

// The real SDK, with only its transport replaced: what a Sentry server would receive is captured instead.
vi.mock('../errorReporting/serverSdk', async () => {
  const actual = await vi.importActual<typeof import('../errorReporting/serverSdk')>('../errorReporting/serverSdk')
  return {
    startServerReporter: (settings: Parameters<typeof actual.startServerReporter>[0]) => {
      startSpy(settings)
      return actual.startServerReporter(settings, () => ({ send: async (envelope: unknown) => { sent.push(envelope as Sent); return {} }, flush: async () => true }))
    },
  }
})

const events = () => sent.flatMap(([, items]) => items).filter(([header]) => header.type === 'event').map(([, payload]) => payload)

async function install(config: Record<string, unknown>) {
  const shared = { odooDb: 'acme_db', sentryEnvironment: 'staging', ...config }
  const perRequest = { ...shared, public: { errorReporting: { enabled: false } } }
  vi.stubGlobal('useRuntimeConfig', (given?: unknown) => (given ? perRequest : shared))
  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
  const hooks: Record<string, Hook> = {}
  const plugin = (await import('../../plugins/error-reporting')).default as unknown as (app: unknown) => void
  plugin({ hooks: { hook: (name: string, handler: Hook) => { hooks[name] = handler } } })
  return { hooks, perRequest }
}

const requestEvent = () => ({
  method: 'GET', path: '/api/v1/orders/1?access_token=secret',
  context: {},
  node: { req: { headers: { 'user-agent': 'UA/1', cookie: 'session_id=secret' } } },
})

describe('error-reporting Nitro plugin', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); sent.length = 0; startSpy.mockClear() })

  it('does nothing without a DSN: no SDK start, no hook, the browser stays off', async () => {
    const { hooks, perRequest } = await install({ sentryDsn: '' })
    expect(Object.keys(hooks)).toEqual([])
    expect(startSpy).not.toHaveBeenCalled()
    expect(perRequest.public.errorReporting.enabled).toBe(false)
  })

  it('reports an unhandled server error once, scrubbed', async () => {
    vi.stubEnv('LIWAN_RELEASE_ID', 'rel-9')
    const { hooks } = await install({ sentryDsn: 'https://abc123@sentry.example.net/7' })
    const thrown = Object.assign(new Error('Internal Server Error'), { statusCode: 500, cause: new Error('failed for 0551234567 a@b.com') })
    await hooks.error!(thrown, { event: requestEvent() })
    await hooks.close!()
    const reported = events()
    expect(reported).toHaveLength(1)
    const event = reported[0]!
    expect(event.exception.values[0].value).toBe('failed for [phone withheld] [email withheld]')
    expect(event.request).toEqual({ method: 'GET', url: '/api/v1/orders/1', headers: { 'User-Agent': 'UA/1' } })
    expect(event.tags).toEqual({ runtime: 'web-server', tenant: 'acme_db', release: 'rel-9' })
    expect(event.environment).toBe('staging')
    expect(JSON.stringify(event)).not.toMatch(/secret|session_id/)
  })

  it('reports a handled 4xx answer never', async () => {
    const { hooks } = await install({ sentryDsn: 'https://abc123@sentry.example.net/7' })
    await hooks.error!(Object.assign(new Error('Not Found'), { statusCode: 404 }), { event: requestEvent() })
    await hooks.error!(Object.assign(new Error('Forbidden'), { statusCode: 403 }), { event: requestEvent() })
    await hooks.close!()
    expect(events()).toHaveLength(0)
  })

  it('tells the browser at runtime, with the key pair and a placeholder host only', async () => {
    const { hooks, perRequest } = await install({ sentryDsn: 'https://abc123@sentry.example.net/7' })
    hooks.request!({ context: {} })
    expect(perRequest.public.errorReporting).toEqual({ enabled: true, dsn: 'https://abc123@errors.invalid/7', release: '', environment: 'staging' })
  })

  it('stops the server at start on an unusable DSN or a missing SDK', async () => {
    await expect(install({ sentryDsn: 'not-a-dsn' })).rejects.toThrow()
    vi.resetModules()
    vi.doMock('../errorReporting/serverSdk', () => { throw new Error('Cannot find package @sentry/node') })
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await install({ sentryDsn: 'https://abc123@sentry.example.net/7' })
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    expect(error).toHaveBeenCalled()
    exit.mockRestore()
    error.mockRestore()
    vi.doUnmock('../errorReporting/serverSdk')
  })
})
