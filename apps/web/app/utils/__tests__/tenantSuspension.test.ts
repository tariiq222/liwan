import { afterEach, describe, expect, it, vi } from 'vitest'

async function load() {
  vi.resetModules()
  return await import('../tenantSuspension')
}

describe('tenantSuspension', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('notifies the listener once per tab and stays latched until a new session clears it', async () => {
    vi.stubGlobal('window', {})
    const latch = await load()
    const listener = vi.fn()
    latch.onTenantSuspension(listener)
    latch.reportTenantSuspension()
    latch.reportTenantSuspension()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(latch.isTenantSuspended()).toBe(true)
    latch.clearTenantSuspension()
    expect(latch.isTenantSuspended()).toBe(false)
  })

  it('never latches on the server, where requests of different users share the module', async () => {
    const latch = await load()
    const listener = vi.fn()
    latch.onTenantSuspension(listener)
    latch.reportTenantSuspension()
    expect(listener).not.toHaveBeenCalled()
    expect(latch.isTenantSuspended()).toBe(false)
  })
})
