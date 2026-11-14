import { describe, expect, it } from 'vitest'
import { signupAcceptanceSchema } from '../commercial/index.js'

describe('sign-up acceptance contract', () => {
  it('parses the version and the instant of acceptance', () => {
    expect(signupAcceptanceSchema.parse({ terms_version: '2026-11-01', accepted_at: '2026-11-13T08:30:00.000Z' }).terms_version).toBe('2026-11-01')
  })
  it('rejects an empty version, a loose date and unknown fields (the client address stays on the server)', () => {
    expect(signupAcceptanceSchema.safeParse({ terms_version: '', accepted_at: '2026-11-13T08:30:00.000Z' }).success).toBe(false)
    expect(signupAcceptanceSchema.safeParse({ terms_version: '1', accepted_at: '13/11/2026' }).success).toBe(false)
    expect(signupAcceptanceSchema.safeParse({ terms_version: '1', accepted_at: '2026-11-13T08:30:00.000Z', ip: '192.0.2.1' }).success).toBe(false)
  })
})
