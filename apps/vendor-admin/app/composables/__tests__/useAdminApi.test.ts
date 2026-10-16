import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createAdminApi, useAdminApi, type AdminApiDeps } from '../useAdminApi'

const failure = (statusCode: number, data?: unknown) => Object.assign(new Error('fetch failed'), { statusCode, data })

describe('createAdminApi', () => {
  it('prefixes the path with the BFF vendor API and passes options through', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true })
    const api = createAdminApi({ fetcher, onUnauthorized: vi.fn() })
    await expect(api.request('/customers', { query: { q: 'a' } })).resolves.toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledWith('/api/vendor/v1/customers', { query: { q: 'a' } })
  })

  it('rejects a path that does not start with a slash', async () => {
    const api = createAdminApi({ fetcher: vi.fn(), onUnauthorized: vi.fn() })
    await expect(api.request('customers')).rejects.toThrow('invalid_path')
  })

  it('runs the unauthorized handler once on 401 and rethrows', async () => {
    const onUnauthorized = vi.fn()
    const fetcher = vi.fn().mockRejectedValue(failure(401, { code: 'auth_failed' }))
    const api = createAdminApi({ fetcher, onUnauthorized })
    await expect(api.request('/x')).rejects.toMatchObject({ statusCode: 401 })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rethrows step_up_required by default and does not retry', async () => {
    const fetcher = vi.fn().mockRejectedValue(failure(403, { code: 'step_up_required' }))
    const api = createAdminApi({ fetcher, onUnauthorized: vi.fn() })
    await expect(api.request('/x', { method: 'POST' })).rejects.toMatchObject({ statusCode: 403 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('hands step_up_required to the hook with a retry that repeats the same request', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(failure(403, { code: 'step_up_required' }))
      .mockResolvedValueOnce({ done: true })
    let stepUps = 0
    const onStepUpRequired: NonNullable<AdminApiDeps['onStepUpRequired']> = (retry) => { stepUps += 1; return retry() }
    const api = createAdminApi({ fetcher, onUnauthorized: vi.fn(), onStepUpRequired })
    await expect(api.request('/x', { method: 'POST', body: { a: 1 } })).resolves.toEqual({ done: true })
    expect(stepUps).toBe(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenLastCalledWith('/api/vendor/v1/x', { method: 'POST', body: { a: 1 } })
  })

  it('runs the unauthorized handler and rethrows when the repeated request is answered 401', async () => {
    const onUnauthorized = vi.fn()
    const fetcher = vi.fn()
      .mockRejectedValueOnce(failure(403, { code: 'step_up_required' }))
      .mockRejectedValueOnce(failure(401, { code: 'unauthorized' }))
    const api = createAdminApi({ fetcher, onUnauthorized, onStepUpRequired: retry => retry() })
    await expect(api.request('/x', { method: 'POST' })).rejects.toMatchObject({ statusCode: 401 })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('does not treat other 403 codes as step-up', async () => {
    const onStepUpRequired = vi.fn()
    const fetcher = vi.fn().mockRejectedValue(failure(403, { code: 'forbidden' }))
    const api = createAdminApi({ fetcher, onUnauthorized: vi.fn(), onStepUpRequired })
    await expect(api.request('/x')).rejects.toMatchObject({ statusCode: 403 })
    expect(onStepUpRequired).not.toHaveBeenCalled()
  })

  it('rethrows every other failure untouched', async () => {
    const error = failure(503, { code: 'vendor_unavailable' })
    const api = createAdminApi({ fetcher: vi.fn().mockRejectedValue(error), onUnauthorized: vi.fn() })
    await expect(api.request('/x')).rejects.toBe(error)
  })
})

describe('useAdminApi', () => {
  const me = ref<unknown>({ id: 7 })
  const navigateTo = vi.fn()
  const run = vi.fn(<T>(retry: () => Promise<T>) => retry())
  beforeEach(() => {
    me.value = { id: 7 }
    vi.stubGlobal('useAdminMe', () => me)
    vi.stubGlobal('useRoute', () => ({ fullPath: '/customers?q=a b' }))
    vi.stubGlobal('useSessionEnded', () => () => { me.value = null; return navigateTo({ path: '/login', query: { next: '/customers?q=a b' } }) })
    vi.stubGlobal('useStepUp', () => ({ run }))
    vi.stubGlobal('navigateTo', navigateTo)
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(failure(401)))
  })
  afterEach(() => { vi.unstubAllGlobals(); navigateTo.mockReset(); run.mockClear() })

  it('clears the session and goes to /login with the encoded current path on 401', async () => {
    await expect(useAdminApi().request('/customers')).rejects.toMatchObject({ statusCode: 401 })
    expect(me.value).toBeNull()
    expect(navigateTo).toHaveBeenCalledWith({ path: '/login', query: { next: '/customers?q=a b' } })
  })

  it('runs a step_up_required response through the step-up flow and repeats the request once', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(failure(403, { code: 'step_up_required' }))
      .mockResolvedValueOnce({ id: 3 })
    vi.stubGlobal('$fetch', fetcher)
    await expect(useAdminApi().request('/admin/accounts', { method: 'POST' })).resolves.toEqual({ id: 3 })
    expect(run).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not repeat the request when the step-up is cancelled', async () => {
    const cancelled = new Error('step_up_cancelled')
    run.mockRejectedValueOnce(cancelled)
    const fetcher = vi.fn().mockRejectedValue(failure(403, { code: 'step_up_required' }))
    vi.stubGlobal('$fetch', fetcher)
    await expect(useAdminApi().request('/admin/accounts', { method: 'POST' })).rejects.toBe(cancelled)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not step up a second time when the repeated request is refused again', async () => {
    const fetcher = vi.fn().mockRejectedValue(failure(403, { code: 'step_up_required' }))
    vi.stubGlobal('$fetch', fetcher)
    await expect(useAdminApi().request('/admin/accounts', { method: 'POST' })).rejects.toMatchObject({ statusCode: 403 })
    expect(run).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
