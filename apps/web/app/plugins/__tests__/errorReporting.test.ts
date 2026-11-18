import { afterEach, describe, expect, it, vi } from 'vitest'

type Sent = [unknown, [{ type: string }, Record<string, any>][]]

const sent: Sent[] = []
const startSpy = vi.fn()

// The real SDK, with only its transport replaced: what the tunnel would receive is captured instead.
vi.mock('../../utils/errorReporting', async () => {
  const actual = await vi.importActual<typeof import('../../utils/errorReporting')>('../../utils/errorReporting')
  return {
    startBrowserReporting: (settings: Parameters<typeof actual.startBrowserReporting>[0], userId: () => number | undefined) => {
      startSpy(settings)
      return actual.startBrowserReporting(settings, userId, () => ({ send: async (envelope: unknown) => { sent.push(envelope as Sent); return {} }, flush: async () => true }))
    },
  }
})

const events = () => sent.flatMap(([, items]) => items).filter(([header]) => header.type === 'event').map(([, payload]) => payload)

async function install(errorReporting: Record<string, unknown>) {
  vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { errorReporting } }))
  const hooks: Record<string, (...args: any[]) => unknown> = {}
  const plugin = (await import('../error-reporting.client')).default as unknown as (app: unknown) => void
  plugin({ payload: { data: { me: { id: 7 } } }, hook: (name: string, handler: (...args: any[]) => unknown) => { hooks[name] = handler } })
  return hooks
}

describe('error-reporting client plugin', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); sent.length = 0; startSpy.mockClear() })

  it('does nothing while the server says reporting is off', async () => {
    const hooks = await install({ enabled: false, dsn: '', release: '', environment: '' })
    expect(Object.keys(hooks)).toEqual([])
    expect(startSpy).not.toHaveBeenCalled()
  })

  it('reports one scrubbed event for a Vue error, with the user id only', async () => {
    const hooks = await install({ enabled: true, dsn: 'https://abc123@errors.invalid/7', release: 'rel-1', environment: 'staging' })
    await hooks['vue:error']!(new Error('render failed for 0551234567'))
    await vi.waitFor(() => expect(events()).toHaveLength(1))
    const event = events()[0]!
    expect(event.exception.values[0].value).toBe('render failed for [phone withheld]')
    expect(event.user).toEqual({ id: '7' })
    expect(event.tags).toEqual({ runtime: 'web-browser', release: 'rel-1' })
    expect(event.request).toBeUndefined()
  })
})
