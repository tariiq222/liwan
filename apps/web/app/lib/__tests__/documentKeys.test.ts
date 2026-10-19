import { describe, expect, it } from 'vitest'
import { DOCUMENT_EXPIRING_DAYS, documentCommittedListParams } from '../documentKeys'

describe('documentCommittedListParams expiry window', () => {
  it('reads any valid window in the URL as the one window the filter offers', () => {
    expect(documentCommittedListParams({ expiring_within: '45' }).expiring_within).toBe(DOCUMENT_EXPIRING_DAYS)
    expect(documentCommittedListParams({ expiring_within: String(DOCUMENT_EXPIRING_DAYS) }).expiring_within).toBe(DOCUMENT_EXPIRING_DAYS)
  })

  it('drops a window that is not a day count', () => {
    for (const value of ['0', '366', 'x', '1.5', undefined]) expect(documentCommittedListParams({ expiring_within: value }).expiring_within).toBeUndefined()
  })
})
