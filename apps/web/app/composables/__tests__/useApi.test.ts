import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../useApi'
import { useApi } from '../useApi'

describe('useApi', () => {
  beforeEach(() => vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })))
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (globalThis as any).$fetch
    delete (globalThis as any).useRequestHeaders
  })

  it('preserves numeric structured error details on ApiError', async () => {
    ;(globalThis as any).useRequestHeaders = vi.fn().mockReturnValue({})
    ;(globalThis as any).$fetch = vi.fn().mockRejectedValue({
      statusCode: 422,
      data: {
        code: 'department_in_use',
        message: 'x',
        details: { employees: 1, children: 0, documents: 2 },
      },
    })

    const { $api } = useApi()
    const error = await $api('/api/v1/hr/departments/1', { method: 'DELETE' }).catch((value) => value)
    const apiError = error as ApiError
    expect(apiError).toBeInstanceOf(ApiError)
    expect(apiError).toMatchObject({ status: 422, code: 'department_in_use', message: 'x' })
    expect(apiError.details).toEqual({ employees: 1, children: 0, documents: 2 })
  })
})

const quotaMessages = {
  'errors.packageQuota.users': 'بلغت الحد المسموح للمستخدمين في حزمتك.',
  'errors.packageQuota.projects': 'بلغت الحد المسموح للمشاريع في حزمتك.',
  'errors.packageQuota.storage': 'بلغت سعة المرفقات المسموح بها في حزمتك.',
  'errors.packageQuota.generic': 'بلغت حد الاستخدام المسموح به في حزمتك.',
}

describe('structured package quota presentation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['users.limit', 'users'],
    ['projects.max_projects', 'projects'],
    ['storage.limit_mb', 'storage'],
    ['unknown.limit', 'generic'],
    [undefined, 'generic'],
  ])('translates %s and preserves structured metadata', async (limitKey, messageKey) => {
    const t = vi.fn((key: string) => quotaMessages[key as keyof typeof quotaMessages])
    vi.stubGlobal('useI18n', () => ({ t }))
    const details = { reason: 'limit', limit_key: limitKey, current: 4, ceiling: 4 }
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ statusCode: 403, data: { code: 'feature_not_included', message: 'this limit has been reached', field: 'project_id', details } }))
    const error = await useApi().$api('/api/v1/projects', { method: 'POST' }).catch(value => value)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 403, code: 'feature_not_included', field: 'project_id', details, message: quotaMessages[`errors.packageQuota.${messageKey}` as keyof typeof quotaMessages] })
    expect(t).toHaveBeenCalledWith(`errors.packageQuota.${messageKey}`)
  })

  it.each([
    ['feature_not_included', { reason: 'module', limit_key: 'users.limit' }],
    ['feature_not_included', undefined],
    ['forbidden', { reason: 'limit', limit_key: 'users.limit' }],
  ])('preserves non-quota errors: %s %j', async (code, details) => {
    const t = vi.fn()
    vi.stubGlobal('useI18n', () => ({ t }))
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ statusCode: 403, data: { code, message: 'Original message', details } }))
    const error = await useApi().$api('/api/v1/projects').catch(value => value)
    expect(error).toMatchObject({ status: 403, code, message: 'Original message', details })
    expect(t).not.toHaveBeenCalled()
  })

  it('does not wrap a Zod contract error', async () => {
    vi.stubGlobal('useI18n', () => ({ t: vi.fn() }))
    const error = Object.assign(new Error('contract mismatch'), { name: 'ZodError' })
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(error))
    await expect(useApi().$api('/api/v1/projects')).rejects.toBe(error)
  })
})
