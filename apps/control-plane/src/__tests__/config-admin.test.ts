import { afterEach, describe, expect, it } from 'vitest'
import { adminConfig } from '../config.js'

const base = { CONTROL_SERVICE_KEY: 'c'.repeat(40) }
describe('adminConfig', () => {
  afterEach(() => { delete process.env.ADMIN_SECRET_KEY })
  it('is off without a secret', () => { expect(adminConfig({ ...base })).toBeUndefined() })
  it('requires 32 bytes and distinct keys', () => {
    expect(() => adminConfig({ ...base, ADMIN_SECRET_KEY: 'short', ADMIN_RP_ID: 'admin.nasq.sa', ADMIN_ORIGIN: 'https://admin.nasq.sa' })).toThrow(/ADMIN_SECRET_KEY/)
    expect(() => adminConfig({ ...base, ADMIN_SECRET_KEY: 'c'.repeat(40), ADMIN_RP_ID: 'admin.nasq.sa', ADMIN_ORIGIN: 'https://admin.nasq.sa' })).toThrow(/distinct/)
    expect(() => adminConfig({ ...base, INTERNAL_EFFECT_KEY: 'i'.repeat(40), ADMIN_SECRET_KEY: 'i'.repeat(40), ADMIN_RP_ID: 'admin.nasq.sa', ADMIN_ORIGIN: 'https://admin.nasq.sa' })).toThrow(/distinct/)
  })
  it('binds origin to the relying party id', () => {
    expect(() => adminConfig({ ...base, ADMIN_SECRET_KEY: 'a'.repeat(40), ADMIN_RP_ID: 'admin.nasq.sa', ADMIN_ORIGIN: 'https://evil.example' })).toThrow(/ADMIN_ORIGIN/)
    expect(() => adminConfig({ ...base, ADMIN_SECRET_KEY: 'a'.repeat(40), ADMIN_RP_ID: 'admin.nasq.sa', ADMIN_ORIGIN: 'http://admin.nasq.sa' })).toThrow(/ADMIN_ORIGIN/)
    expect(adminConfig({ ...base, ADMIN_SECRET_KEY: 'a'.repeat(40), ADMIN_RP_ID: 'localhost', ADMIN_ORIGIN: 'http://localhost:3100' })).toMatchObject({ rpId: 'localhost', origin: 'http://localhost:3100' })
  })
})
