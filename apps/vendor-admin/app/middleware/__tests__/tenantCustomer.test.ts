import { afterEach, describe, expect, it, vi } from 'vitest'

type Handler = (to: { params: { id: string }; query: Record<string, string> }) => Promise<unknown>

function setup(fetcher: (url: string, options: unknown) => Promise<unknown>) {
  const fetch = vi.fn(fetcher)
  const navigateTo = vi.fn((to: unknown, options: unknown) => ({ to, options }))
  vi.stubGlobal('defineNuxtRouteMiddleware', (handler: Handler) => handler)
  vi.stubGlobal('useRequestFetch', () => fetch)
  vi.stubGlobal('navigateTo', navigateTo)
  return { fetch, navigateTo }
}
async function run(query: Record<string, string> = {}) {
  const { default: middleware } = await import('../tenant-customer')
  return (middleware as unknown as Handler)({ params: { id: 'tenant-1' }, query })
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('tenant-customer', () => {
  it('replaces the workspace route with the customer workspace tab, keeping the return target', async () => {
    const { fetch, navigateTo } = setup(async () => ({ items: [{ id: 'cust/1', tenant_id: 'tenant-1' }] }))
    await run({ returnTo: '/customers?q=a', tab: 'bogus' })
    expect(fetch).toHaveBeenCalledWith('/api/vendor/v1/commercial/customers', { query: { tenant_id: 'tenant-1', limit: 1 } })
    expect(navigateTo).toHaveBeenCalledWith({ path: '/customers/cust%2F1', query: { returnTo: '/customers?q=a', tab: 'workspace' } }, { replace: true })
  })
  it('keeps the operations tab when it is the one requested', async () => {
    const { navigateTo } = setup(async () => ({ items: [{ id: 'cust-1', tenant_id: 'tenant-1' }] }))
    await run({ tab: 'operations' })
    expect(navigateTo).toHaveBeenCalledWith({ path: '/customers/cust-1', query: { tab: 'operations' } }, { replace: true })
  })
  it('stays on the workspace page when no customer owns it', async () => {
    const { navigateTo } = setup(async () => ({ items: [] }))
    expect(await run()).toBeUndefined()
    expect(navigateTo).not.toHaveBeenCalled()
  })
  it('ignores a customer the service returned for another workspace', async () => {
    const { navigateTo } = setup(async () => ({ items: [{ id: 'cust-2', tenant_id: 'tenant-2' }] }))
    await run()
    expect(navigateTo).not.toHaveBeenCalled()
  })
  it.each([404, 501])('stays on the workspace page when the customers service answers %i', async statusCode => {
    const { navigateTo } = setup(async () => { throw Object.assign(new Error('missing'), { statusCode }) })
    expect(await run()).toBeUndefined()
    expect(navigateTo).not.toHaveBeenCalled()
  })
  it.each([401, 403, 500, 503])('rethrows a %i so the auth flow or error page handles it', async statusCode => {
    const { navigateTo } = setup(async () => { throw Object.assign(new Error('failed'), { statusCode }) })
    await expect(run()).rejects.toMatchObject({ statusCode })
    expect(navigateTo).not.toHaveBeenCalled()
  })
})
