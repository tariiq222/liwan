import { describe, expect, it } from 'vitest'
import { STATUS_CHIP_CLASS, STATUS_TEXT_CLASS } from '../statusTone'

describe('statusTone', () => {
  it('maps every tone to a semantic chip class instead of a Tailwind palette', () => {
    expect(STATUS_CHIP_CLASS.success).toBe('nasq-status-chip-success')
    expect(STATUS_CHIP_CLASS.warning).toBe('nasq-status-chip-warning')
    expect(STATUS_CHIP_CLASS.info).toBe('nasq-status-chip-info')
    expect(STATUS_CHIP_CLASS.destructive).toBe('nasq-status-chip-danger')
    expect(STATUS_CHIP_CLASS.neutral).toBe('nasq-status-chip-muted')
    expect(Object.values(STATUS_CHIP_CLASS).join(' ')).not.toMatch(/emerald|amber|red-|green-|yellow-/)
  })

  it('maps destructive text to the contrast-safe danger token class', () => {
    expect(STATUS_TEXT_CLASS.warning).toBe('nasq-status-text-warning')
    expect(STATUS_TEXT_CLASS.success).toBe('nasq-status-text-success')
    expect(STATUS_TEXT_CLASS.destructive).toBe('nasq-status-text-danger')
  })
})
