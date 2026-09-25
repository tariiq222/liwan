import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VENDOR_CAPABILITIES, useVendorContext, type VendorCapability } from '../useVendorContext'

type Actor = { id: number }

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (cause: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

/**
 * Replaces the Nuxt auto-imports `useVendorContext` depends on. `useAsyncData`
 * is deliberately inert: it records the handler and returns a stand-in so each
 * case drives `refresh()` explicitly and deterministically.
 */
function setup(options: { enabled: unknown, actorId?: number | null }) {
  const store = new Map<string, Ref<unknown>>()
  const me = ref<Actor | null>(options.actorId === undefined || options.actorId === null ? null : { id: options.actorId })
  const meReady = Promise.resolve()
  const fetchMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>({ enabled: true, capabilities: [] }))

  const stateStub = <T>(key: string, init: () => T): Ref<T> => {
    if (!store.has(key)) store.set(key, ref(init()) as Ref<unknown>)
    return store.get(key) as Ref<T>
  }

  vi.stubGlobal('useRuntimeConfig', () => ({ public: { vendorWorkspaceEnabled: options.enabled } }))
  vi.stubGlobal('useMe', () => ({ me, ready: meReady }))
  vi.stubGlobal('useState', stateStub)
  vi.stubGlobal('useAsyncData', (_key: string, handler: unknown) => ({ data: ref(null), pending: ref(false), error: ref(null), refresh: handler }))
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('$fetch', fetchMock)

  return { me, fetchMock, context: useVendorContext() }
}

afterEach(() => vi.unstubAllGlobals())

describe('useVendorContext', () => {
  it('treats only the boolean true or the string "true" runtime flag as enabled', () => {
    expect(setup({ enabled: false, actorId: 7 }).context.enabled).toBe(false)
    expect(setup({ enabled: 'false', actorId: 7 }).context.enabled).toBe(false)
    expect(setup({ enabled: true, actorId: 7 }).context.enabled).toBe(true)
    expect(setup({ enabled: 'true', actorId: 7 }).context.enabled).toBe(true)
  })

  it('stays disabled and never calls the control service when the workspace flag is off', async () => {
    const { context, fetchMock } = setup({ enabled: false, actorId: 7 })

    await expect(context.refresh()).resolves.toEqual({ enabled: false, capabilities: [] })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(context.capabilities.value).toEqual([])
    expect(context.error.value).toBeNull()
    expect(context.can('vendor.read')).toBe(false)
  })

  it('skips the control service and clears state when there is no signed-in actor', async () => {
    const { context, fetchMock } = setup({ enabled: true, actorId: null })

    await expect(context.refresh()).resolves.toEqual({ enabled: false, capabilities: [] })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(context.capabilities.value).toEqual([])
    expect(context.error.value).toBeNull()
  })

  it('denies every capability until an actor context has loaded', () => {
    const { context } = setup({ enabled: true, actorId: 7 })
    for (const capability of VENDOR_CAPABILITIES) expect(context.can(capability)).toBe(false)
    expect(context.can('vendor.read')).toBe(false)
  })

  it('loads the signed-in actor capabilities from the BFF context endpoint', async () => {
    const { context, fetchMock } = setup({ enabled: true, actorId: 7 })
    fetchMock.mockResolvedValueOnce({ enabled: true, capabilities: ['vendor.read', 'vendor.audit.read'] })

    await expect(context.refresh()).resolves.toEqual({ enabled: true, capabilities: ['vendor.read', 'vendor.audit.read'] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/vendor/v1/context')
    expect(context.capabilities.value).toEqual(['vendor.read', 'vendor.audit.read'])
    expect(context.error.value).toBeNull()
    expect(context.can('vendor.read')).toBe(true)
    expect(context.can('vendor.audit.read')).toBe(true)
    expect(context.can('vendor.tenants.manage')).toBe(false)
  })

  it('rejects malformed context payloads instead of granting capabilities', async () => {
    const malformed: Array<[string, unknown]> = [
      ['a disabled payload', { enabled: false, capabilities: ['vendor.read'] }],
      ['a missing enabled flag', { capabilities: ['vendor.read'] }],
      ['a non-array capability list', { enabled: true, capabilities: 'vendor.read' }],
      ['an unknown capability', { enabled: true, capabilities: ['vendor.superuser'] }],
      ['a non-object payload', 'vendor.read'],
      ['a null payload', null],
    ]

    for (const [label, payload] of malformed) {
      const { context, fetchMock } = setup({ enabled: true, actorId: 7 })
      fetchMock.mockResolvedValueOnce(payload)

      await expect(context.refresh(), label).resolves.toEqual({ enabled: false, capabilities: [] })
      expect(context.capabilities.value, label).toEqual([])
      expect(context.error.value, label).toEqual({
        statusCode: null,
        code: 'vendor_unavailable',
        message: 'Invalid vendor context response',
      })
      expect(context.can('vendor.read'), label).toBe(false)
    }
  })

  it('maps an upstream control failure to a structured error and drops stale grants', async () => {
    const { context, fetchMock } = setup({ enabled: true, actorId: 7 })
    fetchMock.mockResolvedValueOnce({ enabled: true, capabilities: ['vendor.read'] })
    await context.refresh()
    expect(context.capabilities.value).toEqual(['vendor.read'])

    fetchMock.mockRejectedValueOnce(Object.assign(new Error('control service unavailable'), {
      statusCode: 503,
      data: { code: 'vendor_outage', message: 'Control service is unavailable' },
    }))

    await expect(context.refresh()).resolves.toEqual({ enabled: false, capabilities: [] })

    expect(context.capabilities.value).toEqual([])
    expect(context.error.value).toEqual({ statusCode: 503, code: 'vendor_outage', message: 'Control service is unavailable' })
    expect(context.can('vendor.read')).toBe(false)
  })

  it('drops the previous actor grants as soon as the signed-in actor changes', async () => {
    const { context, fetchMock, me } = setup({ enabled: true, actorId: 7 })
    fetchMock.mockResolvedValueOnce({ enabled: true, capabilities: ['vendor.read'] })
    await context.refresh()
    expect(context.capabilities.value).toEqual(['vendor.read'])

    const next = deferred<unknown>()
    fetchMock.mockImplementation(() => next.promise)
    me.value = { id: 8 }
    await nextTick()

    expect(context.capabilities.value, 'grants are cleared before the new response lands').toEqual([])
    expect(context.can('vendor.read')).toBe(false)

    next.resolve({ enabled: true, capabilities: ['vendor.audit.read'] })
    await vi.waitFor(() => expect(context.capabilities.value).toEqual(['vendor.audit.read']))
    expect(context.can('vendor.audit.read')).toBe(true)
    expect(context.can('vendor.read')).toBe(false)
  })

  it('discards an in-flight response that belongs to a previous actor', async () => {
    const { context, fetchMock, me } = setup({ enabled: true, actorId: 7 })
    const stale = deferred<unknown>()
    const current = deferred<unknown>()
    fetchMock.mockReturnValueOnce(stale.promise).mockImplementation(() => current.promise)

    const pending = context.refresh()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    me.value = { id: 8 }
    await nextTick()
    current.resolve({ enabled: true, capabilities: ['vendor.audit.read'] })
    await vi.waitFor(() => expect(context.capabilities.value).toEqual(['vendor.audit.read']))

    stale.resolve({ enabled: true, capabilities: ['vendor.read'] })

    await expect(pending, 'the previous actor response is not reported as a success').resolves.toEqual({ enabled: false, capabilities: [] })
    expect(context.capabilities.value, 'the previous actor grants are never applied').toEqual(['vendor.audit.read'])
    expect(context.can('vendor.read')).toBe(false)
    expect(context.can('vendor.audit.read')).toBe(true)
  })

  it('exposes a pending state only while the context request is in flight', async () => {
    const { context, fetchMock } = setup({ enabled: true, actorId: 7 })
    const inflight = deferred<unknown>()
    fetchMock.mockReturnValueOnce(inflight.promise)

    const pending = context.refresh()
    await vi.waitFor(() => expect(context.pending.value).toBe(true))

    inflight.resolve({ enabled: true, capabilities: ['vendor.read'] })
    await pending

    expect(context.pending.value).toBe(false)
  })
})
