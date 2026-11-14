import { describe, expect, it } from 'vitest'
import { inboxContactName } from '../inboxContactName'

const t = (key: string, values?: Record<string, unknown>) => `${key}:${values?.id ?? ''}`

describe('inboxContactName', () => {
  it('shows the stored name of a contact that is not erased', () => {
    expect(inboxContactName({ id: 4, name: 'منى العتيبي', erased: false }, t)).toBe('منى العتيبي')
  })

  it('shows the translated name with the number for an erased contact, never the stored marker', () => {
    expect(inboxContactName({ id: 3, name: 'Erased contact 3', erased: true }, t)).toBe('inbox.erasedContact:3')
  })
})
