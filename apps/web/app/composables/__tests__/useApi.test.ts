import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../useApi'
import { useApi } from '../useApi'

describe('useApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'department_in_use', message: 'x' })
    expect(error.details).toEqual({ employees: 1, children: 0, documents: 2 })
  })
})
