import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../useApi'
import { useApi } from '../useApi'

describe('useApi', () => {
  beforeEach(() => vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, te: (key: string) => key.startsWith('errors.api'), locale: { value: 'ar' } })))
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
    expect(apiError).toMatchObject({ status: 422, code: 'department_in_use', message: 'errors.api.invalid', })
    expect(apiError.details).toEqual({ employees: 1, children: 0, documents: 2 })
  })
})

describe('useApi download', () => {
  beforeEach(() => {
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, te: (key: string) => key.startsWith('errors.api'), locale: { value: 'ar' } }))
    ;(globalThis as any).useRequestHeaders = vi.fn().mockReturnValue({})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as any).$fetch
    delete (globalThis as any).useRequestHeaders
  })

  it('returns the blob and the file name the server chose', async () => {
    const blob = new Blob(['a,b'])
    ;(globalThis as any).$fetch = Object.assign(vi.fn(), {
      raw: vi.fn().mockResolvedValue({ _data: blob, headers: new Headers({ 'content-disposition': 'attachment; filename="salaries-2026-10.csv"' }) }),
    })
    const { $download } = useApi()
    await expect($download('/api/v1/hr/payroll/runs/1/bank-file', { method: 'POST', body: { profile_id: 1 } })).resolves.toEqual({ blob, filename: 'salaries-2026-10.csv' })
    expect((globalThis as any).$fetch.raw).toHaveBeenCalledWith('/api/v1/hr/payroll/runs/1/bank-file', expect.objectContaining({ method: 'POST', body: { profile_id: 1 }, retry: 0 }))
  })

  it('reads the structured refusal out of a blob body', async () => {
    const data = new Blob([JSON.stringify({ code: 'missing_iban', message: 'x', details: { employee_ids: [4] } })])
    ;(globalThis as any).$fetch = Object.assign(vi.fn(), { raw: vi.fn().mockRejectedValue({ statusCode: 422, data }) })
    const { $download } = useApi()
    const error = await $download('/api/v1/hr/payroll/runs/1/bank-file', { method: 'POST', body: { profile_id: 1 } }).catch(value => value)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'missing_iban', details: { employee_ids: [4] } })
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
  ])('does not use the quota text for %s %j', async (code, details) => {
    const t = vi.fn((key: string) => key)
    vi.stubGlobal('useI18n', () => ({ t, te: (key: string) => key.startsWith('errors.api'), locale: { value: 'ar' } }))
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ statusCode: 403, data: { code, message: 'Original message', details } }))
    const error = await useApi().$api('/api/v1/projects').catch(value => value)
    expect(error).toMatchObject({ status: 403, code, message: 'errors.api.forbidden', details })
    expect(t).not.toHaveBeenCalledWith(expect.stringContaining('packageQuota'))
  })

  it('does not wrap a Zod contract error', async () => {
    vi.stubGlobal('useI18n', () => ({ t: vi.fn() }))
    const error = Object.assign(new Error('contract mismatch'), { name: 'ZodError' })
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(error))
    await expect(useApi().$api('/api/v1/projects')).rejects.toBe(error)
  })
})

describe('interrupted writes', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('states an unknown write outcome and explicitly disables transport retries', async () => {
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, te: (key: string) => key.startsWith('errors.api'), locale: { value: 'ar' } }))
    const fetch = vi.fn().mockRejectedValue(new Error('connection failed'))
    vi.stubGlobal('$fetch', fetch)
    await expect(useApi().$api('/api/v1/tasks', { method: 'POST', body: { name: 'draft' } })).rejects.toMatchObject({ status: 0, message: 'errors.saveUncertain' })
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ retry: 0 })
  })
})

describe('localized server refusals', () => {
  const ar: Record<string, string> = {
    'errors.api.invalid': 'تعذّر الحفظ لأن بعض البيانات غير صحيحة.',
    'errors.api.notFound': 'العنصر غير موجود أو حُذف.',
    'errors.api.unavailable': 'الخدمة غير متاحة الآن.',
    'errors.codes.stale_write': 'تغيّرت البيانات.',
    'errors.reasons.self_chat': 'لا يمكنك بدء محادثة مع نفسك.',
    'errors.generic': 'حدث خطأ غير متوقع',
  }
  let locale = 'ar'
  const fail = async (statusCode: number, data: unknown) => {
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => ar[key] ?? key, te: (key: string) => key in ar, locale: { value: locale } }))
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ statusCode, data }))
    return useApi().$api('/api/v1/chat/channels', { method: 'POST' }).catch(value => value) as Promise<ApiError>
  }
  afterEach(() => { locale = 'ar'; vi.unstubAllGlobals() })

  it('never surfaces an English server message under the Arabic UI', async () => {
    const error = await fail(422, { code: 'invalid', message: 'cannot chat with yourself', field: 'partner_id' })
    expect(error.message).toBe(ar['errors.api.invalid'])
    expect(error.field).toBe('partner_id')
  })

  it.each([
    [404, 'not_found', 'errors.api.notFound'],
    [503, 'pdf_unavailable_x', 'errors.api.unavailable'],
    [422, 'some_business_rule', 'errors.api.invalid'],
    [409, 'stale_write', 'errors.codes.stale_write'],
    [418, 'teapot', 'errors.generic'],
  ])('maps %s %s to %s', async (status, code, key) => {
    const error = await fail(status, { code, message: 'English text' })
    expect(error.message).toBe(ar[key])
  })

  it('prefers details.reason when its locale key exists', async () => {
    expect((await fail(422, { code: 'invalid', message: 'x', details: { reason: 'self_chat' } })).message).toBe(ar['errors.reasons.self_chat'])
    expect((await fail(422, { code: 'invalid', message: 'x', details: { reason: 'unknown_reason' } })).message).toBe(ar['errors.api.invalid'])
  })

  it('shows a server message already written in the UI language', async () => {
    expect((await fail(422, { code: 'invalid', message: 'الاسم مستخدم من قبل', field: 'name' })).message).toBe('الاسم مستخدم من قبل')
    locale = 'en'
    expect((await fail(422, { code: 'invalid', message: 'Name already used' })).message).toBe('Name already used')
    expect((await fail(422, { code: 'invalid', message: 'الاسم مستخدم' })).message).toBe(ar['errors.api.invalid'])
  })

  it('leaves a non-JSON failure untouched', async () => {
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => ar[key] ?? key, te: (key: string) => key.startsWith('errors.api'), locale: { value: 'ar' } }))
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ statusCode: 502, message: 'Bad Gateway', data: '<html>' }))
    const error = await useApi().$api('/api/v1/chat/channels').catch(value => value)
    expect(error).toMatchObject({ status: 502, code: 'http_error', message: 'Bad Gateway' })
  })
})
