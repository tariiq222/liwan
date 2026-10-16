import { computed, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVendorContextState } from '../../composables/useVendorContext'

type Handler = (to: { fullPath: string }) => Promise<unknown>

function setup(actorId: number | null, context: () => Promise<unknown>) {
  const store = new Map<string, ReturnType<typeof ref>>()
  const me = ref<{ id: number } | null>(actorId === null ? null : { id: actorId })
  const fetcher = vi.fn(context)
  const navigateTo = vi.fn((to: unknown) => to)
  vi.stubGlobal('defineNuxtRouteMiddleware', (handler: Handler) => handler)
  vi.stubGlobal('useAdminSession', () => ({ me, ready: Promise.resolve() }))
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!store.has(key)) store.set(key, ref(init()))
    return store.get(key)
  })
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useVendorContextState', useVendorContextState)
  vi.stubGlobal('useRequestFetch', () => fetcher)
  vi.stubGlobal('navigateTo', navigateTo)
  return { me, fetcher, navigateTo }
}

const ok = () => Promise.resolve({ enabled: true, capabilities: ['vendor.read'] })
async function run(path = '/customers') {
  const { default: middleware } = await import('../10.vendor-context.global')
  return (middleware as unknown as Handler)({ fullPath: path })
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('10.vendor-context.global', () => {
  it('does not call the control service for a signed-out user', async () => {
    const { fetcher } = setup(null, ok)
    await run()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('loads the context once and does not refetch on a same-account navigation', async () => {
    const { fetcher } = setup(7, ok)
    await run('/customers')
    await run('/invoices')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('/api/vendor/v1/context')
  })

  it('refetches when the signed-in account changes', async () => {
    const { fetcher, me } = setup(7, ok)
    await run()
    me.value = { id: 8 }
    await run()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('records a failed context and retries on the next navigation', async () => {
    const { fetcher } = setup(7, () => Promise.reject(Object.assign(new Error('down'), { statusCode: 503 })))
    await run()
    await run()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('sends a 401 to the sign-in page with the target route as next', async () => {
    const { navigateTo } = setup(7, () => Promise.reject(Object.assign(new Error('no'), { statusCode: 401 })))
    await run('/invoices?status=paid')
    expect(navigateTo).toHaveBeenCalledWith({ path: '/login', query: { next: '/invoices?status=paid' } })
  })
})
