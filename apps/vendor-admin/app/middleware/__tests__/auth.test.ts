import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

type Route = { path: string, fullPath: string, query: Record<string, unknown>, meta: { public?: boolean, capability?: string } }
const route = (path: string, meta: Route['meta'] = {}, query: Record<string, unknown> = {}): Route => ({ path, fullPath: path, query, meta })

describe('global auth middleware', () => {
  const navigateTo = vi.fn((target: unknown) => target)
  const createError = vi.fn((input: { statusCode: number }) => Object.assign(new Error('x'), input))
  let me: ReturnType<typeof ref>
  let ready: Promise<void>
  let middleware: (to: Route) => Promise<unknown>

  beforeEach(async () => {
    me = ref(null)
    ready = Promise.resolve()
    vi.stubGlobal('defineNuxtRouteMiddleware', (fn: unknown) => fn)
    vi.stubGlobal('useAdminSession', () => ({ me, get ready() { return ready } }))
    vi.stubGlobal('navigateTo', navigateTo)
    vi.stubGlobal('createError', createError)
    vi.resetModules()
    middleware = (await import('../00.auth.global')).default as unknown as typeof middleware
  })
  afterEach(() => { vi.unstubAllGlobals(); navigateTo.mockClear(); createError.mockClear() })

  it('sends a signed-out visitor of a protected page to sign-in with a safe next', async () => {
    await middleware({ ...route('/customers'), fullPath: '/customers?q=a' })
    expect(navigateTo).toHaveBeenCalledWith({ path: '/login', query: { next: '/customers?q=a' } })
  })

  it('treats a page with neither public nor a capability as protected', async () => {
    await middleware(route('/anything'))
    expect(navigateTo).toHaveBeenCalledWith({ path: '/login', query: { next: '/anything' } })
  })

  it('answers forbidden when the session lacks the page capability', async () => {
    me.value = { capabilities: ['vendor.read'] }
    await expect(middleware(route('/audit', { capability: 'vendor.audit.read' }))).rejects.toMatchObject({ statusCode: 403 })
    expect(createError).toHaveBeenCalledWith(expect.objectContaining({ fatal: true }))
  })

  it('allows a session with the capability', async () => {
    me.value = { capabilities: ['vendor.audit.read'] }
    await expect(middleware(route('/audit', { capability: 'vendor.audit.read' }))).resolves.toBeUndefined()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('lets a public page open without a session and without asking for one', async () => {
    const asked = vi.fn(() => Promise.resolve())
    vi.stubGlobal('useAdminSession', () => ({ me, get ready() { asked(); return ready } }))
    vi.resetModules()
    middleware = (await import('../00.auth.global')).default as unknown as typeof middleware
    await expect(middleware(route('/enroll', { public: true }))).resolves.toBeUndefined()
    expect(asked).not.toHaveBeenCalled()
  })

  it('still opens the sign-in page when the session endpoint fails', async () => {
    ready = Promise.reject(Object.assign(new Error('x'), { statusCode: 503 }))
    ready.catch(() => undefined)
    await expect(middleware(route('/login', { public: true }))).resolves.toBeUndefined()
  })

  it('shows an error page for a protected page when the session endpoint fails', async () => {
    ready = Promise.reject(Object.assign(new Error('x'), { statusCode: 503 }))
    ready.catch(() => undefined)
    await expect(middleware(route('/customers'))).rejects.toMatchObject({ statusCode: 503 })
    expect(createError).toHaveBeenCalledWith(expect.objectContaining({ fatal: true }))
  })

  it('treats /login/ as the sign-in page', async () => {
    ready = Promise.reject(Object.assign(new Error('x'), { statusCode: 503 }))
    ready.catch(() => undefined)
    await expect(middleware(route('/login/', { public: true }))).resolves.toBeUndefined()
  })

  it('moves a signed-in visitor off the sign-in page', async () => {
    me.value = { capabilities: [] }
    await middleware(route('/login', { public: true }, { next: '/audit' }))
    expect(navigateTo).toHaveBeenCalledWith('/audit')
  })
})
