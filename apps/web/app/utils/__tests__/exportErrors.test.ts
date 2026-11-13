import { describe, expect, it } from 'vitest'
import { ApiError } from '../../composables/useApi'
import { exportTooLargeMessage } from '../exportErrors'

const t = (key: string, params?: Record<string, unknown>) => `${key}|${params?.max}`
const n = (value: number) => `#${value}`

describe('exportTooLargeMessage', () => {
  it('names the row limit, formatted, when the filters keep more rows than one file carries', () => {
    const error = new ApiError(422, 'export_too_large', 'raw', undefined, { rows: 61000, max_rows: 50000 })
    expect(exportTooLargeMessage(error, t, n)).toBe('errors.exportTooLarge|#50000')
  })

  it('is null for any other refusal, a refusal without the details and a non-error', () => {
    expect(exportTooLargeMessage(new ApiError(422, 'invalid', 'raw'), t, n)).toBeNull()
    expect(exportTooLargeMessage(new ApiError(422, 'export_too_large', 'raw', undefined, { rows: 1 }), t, n)).toBeNull()
    expect(exportTooLargeMessage(new ApiError(403, 'forbidden', 'raw'), t, n)).toBeNull()
    expect(exportTooLargeMessage(undefined, t, n)).toBeNull()
  })
})
