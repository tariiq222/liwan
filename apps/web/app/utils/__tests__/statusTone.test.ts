import { describe, expect, it } from 'vitest'
import { STATUS_COLOR } from '../statusTone'

describe('statusTone', () => {
  it('maps every tone to a semantic color for Nuxt UI badges', () => {
    expect(STATUS_COLOR.success).toBe('success')
    expect(STATUS_COLOR.warning).toBe('warning')
    expect(STATUS_COLOR.info).toBe('info')
    expect(STATUS_COLOR.destructive).toBe('error')
    expect(STATUS_COLOR.neutral).toBe('neutral')
  })
})
