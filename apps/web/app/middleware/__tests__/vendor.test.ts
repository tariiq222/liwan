import { afterEach, describe, expect, it, vi } from 'vitest'

type VendorCapability = 'vendor.read' | 'vendor.tenants.manage' | 'vendor.catalog.manage' | 'vendor.operations.run' | 'vendor.audit.read'

type GuardContext = {
  enabled: boolean
  capabilities: { value: VendorCapability[] }
  ready: unknown
  refresh: () => Promise<unknown>
}

type GuardTarget = { meta: { vendorCapability?: unknown } }
type Guard = (to: GuardTarget) => Promise<unknown>

type ErrorInput = { statusCode: number, statusMessage: string }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => { resolve = next })
  return { promise, resolve }
}

/**
 * `middleware/vendor.ts` calls the auto-imported `defineNuxtRouteMiddleware`
 * at module evaluation time, so the global has to exist before the import and
 * the module registry has to be reset between cases.
 */
async function loadGuard(): Promise<Guard> {
  vi.resetModules()
  vi.stubGlobal('defineNuxtRouteMiddleware', (handler: Guard) => handler)
  const module = await import('../vendor')
  return module.default as unknown as Guard
}

function stubContext(context: GuardContext) {
  vi.stubGlobal('useVendorContext', () => context)
}

function stubNavigation() {
  const createError = vi.fn((input: ErrorInput) => Object.assign(new Error(input.statusMessage), input))
  const abortNavigation = vi.fn(() => false)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('abortNavigation', abortNavigation)
  return { createError, abortNavigation }
}

afterEach(() => vi.unstubAllGlobals())

describe('vendor route middleware', () => {
  it('hides the vendor surface with 404 when the workspace flag is off', async () => {
    const refresh = vi.fn(async () => ({ enabled: false, capabilities: [] }))
    stubContext({ enabled: false, capabilities: { value: [] }, ready: Promise.resolve(), refresh })
    const navigation = stubNavigation()
    const guard = await loadGuard()

    await expect(guard({ meta: { vendorCapability: 'vendor.read' } })).resolves.toBe(false)

    expect(navigation.createError).toHaveBeenCalledWith({ statusCode: 404, statusMessage: 'Not Found' })
    expect(navigation.abortNavigation).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('waits for the context load, then refreshes before checking the capability', async () => {
    const order: string[] = []
    const ready = deferred()
    const refresh = vi.fn(async () => {
      order.push('refresh')
      return { enabled: true, capabilities: ['vendor.read'] as VendorCapability[] }
    })
    stubContext({ enabled: true, capabilities: { value: ['vendor.read'] }, ready: ready.promise, refresh })
    const navigation = stubNavigation()
    const guard = await loadGuard()

    const settled = guard({ meta: { vendorCapability: 'vendor.read' } }).then((value) => {
      order.push('settled')
      return value
    })
    await Promise.resolve()
    expect(refresh).not.toHaveBeenCalled()

    ready.resolve()
    await expect(settled).resolves.toBeUndefined()

    expect(order).toEqual(['refresh', 'settled'])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(navigation.abortNavigation).not.toHaveBeenCalled()
  })

  it('rejects a vendor page that declares no capability with 403', async () => {
    const refresh = vi.fn(async () => ({ enabled: true, capabilities: ['vendor.read'] }))
    stubContext({ enabled: true, capabilities: { value: ['vendor.read'] }, ready: Promise.resolve(), refresh })
    const navigation = stubNavigation()
    const guard = await loadGuard()

    await expect(guard({ meta: {} })).resolves.toBe(false)

    expect(navigation.createError).toHaveBeenCalledWith({ statusCode: 403, statusMessage: 'Forbidden' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-string declared capability with 403', async () => {
    const refresh = vi.fn(async () => ({ enabled: true, capabilities: ['vendor.read'] }))
    stubContext({ enabled: true, capabilities: { value: ['vendor.read'] }, ready: Promise.resolve(), refresh })
    const navigation = stubNavigation()
    const guard = await loadGuard()

    await expect(guard({ meta: { vendorCapability: 42 } })).resolves.toBe(false)

    expect(navigation.createError).toHaveBeenCalledWith({ statusCode: 403, statusMessage: 'Forbidden' })
  })

  it('rejects a declared capability the operator does not hold with 403', async () => {
    const refresh = vi.fn(async () => ({ enabled: true, capabilities: ['vendor.read'] }))
    stubContext({ enabled: true, capabilities: { value: ['vendor.read'] }, ready: Promise.resolve(), refresh })
    const navigation = stubNavigation()
    const guard = await loadGuard()

    await expect(guard({ meta: { vendorCapability: 'vendor.tenants.manage' } })).resolves.toBe(false)

    expect(navigation.createError).toHaveBeenCalledWith({ statusCode: 403, statusMessage: 'Forbidden' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('allows a page whose declared capability is held by the refreshed context', async () => {
    const refresh = vi.fn(async () => ({ enabled: true, capabilities: ['vendor.read', 'vendor.tenants.manage'] }))
    stubContext({ enabled: true, capabilities: { value: ['vendor.read', 'vendor.tenants.manage'] }, ready: Promise.resolve(), refresh })
    const navigation = stubNavigation()
    const guard = await loadGuard()

    await expect(guard({ meta: { vendorCapability: 'vendor.tenants.manage' } })).resolves.toBeUndefined()

    expect(navigation.abortNavigation).not.toHaveBeenCalled()
    expect(navigation.createError).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('checks the capability against the context returned by refresh, not a stale list', async () => {
    const stale: VendorCapability[] = ['vendor.read']
    const refresh = vi.fn(async () => {
      stale.length = 0
      return { enabled: true, capabilities: [] }
    })
    stubContext({ enabled: true, capabilities: { value: stale }, ready: Promise.resolve(), refresh })
    const navigation = stubNavigation()
    const guard = await loadGuard()

    await expect(guard({ meta: { vendorCapability: 'vendor.read' } })).resolves.toBe(false)

    expect(navigation.createError).toHaveBeenCalledWith({ statusCode: 403, statusMessage: 'Forbidden' })
  })
})
