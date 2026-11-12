import { describe, expect, it } from 'vitest'

import {
  LoginCodeRequestSchema,
  LoginCodeSentSchema,
  LoginDevicesForgottenSchema,
  LoginStepSchema,
  LoginVerifyResultSchema,
} from '../two-step'

const me = {
  id: 7, name: 'Synthetic User', login: 'synthetic', email: 's@example.test', mobile: null,
  mobile_required: false, lang: 'ar_001', tz: 'Asia/Riyadh', role: 'employee', roles: [],
  capabilities: [], access_policy_version: 1, company: { id: 1, name: 'Synthetic' }, companies: [{ id: 1, name: 'Synthetic' }], home_company_id: 1, home_capabilities: [],
  appearance: { mode: 'light', font_size: 'small' }, modules: [], entitlements: {},
  platform: {
    schema_version: 1, policy_revision: 1, state: 'active', valid_until: null, read_only: false,
    readable_features: [], writable_features: [],
  },
  terminology: { ar: {}, en: {} },
}

describe('the password step answer', () => {
  it('is either a finished session or the pending one the code step continues', () => {
    expect(LoginStepSchema.parse({ ok: true })).toEqual({ ok: true })
    expect(LoginStepSchema.parse({ ok: false, mfa: 'code' })).toEqual({ ok: false, mfa: 'code' })
  })

  it('refuses the retired authenticator answer and any extra field', () => {
    expect(() => LoginStepSchema.parse({ ok: false, mfa: 'totp' })).toThrow()
    expect(() => LoginStepSchema.parse({ ok: true, mfa: 'code' })).toThrow()
  })
})

describe('finishing the sign-in', () => {
  it('carries the signed-in identity and whether the browser was remembered', () => {
    expect(LoginVerifyResultSchema.parse({ ...me, remembered: true })).toMatchObject({ id: 7, remembered: true })
    expect(() => LoginVerifyResultSchema.parse({ ...me, remembered: 'yes' })).toThrow()
  })

  it('refuses an identity without the remembered flag', () => {
    expect(() => LoginVerifyResultSchema.parse(me)).toThrow()
  })
})

describe('a sent code', () => {
  it('names the channel, the server-masked destination and the server wait', () => {
    expect(LoginCodeRequestSchema.parse({ channel: 'email' })).toEqual({ channel: 'email' })
    expect(LoginCodeSentSchema.parse({ channel: 'email', destination: 's***@example.test', resend_after: 60 })).toEqual({
      channel: 'email', destination: 's***@example.test', resend_after: 60,
    })
    expect(() => LoginCodeSentSchema.parse({ channel: 'email', destination: 's***@example.test', resend_after: 1.5 })).toThrow()
  })
})

describe('forgetting devices', () => {
  it('lists the ids that are still remembered and nothing else', () => {
    expect(LoginDevicesForgottenSchema.parse({ device_ids: [3, 1] })).toEqual({ device_ids: [3, 1] })
    expect(() => LoginDevicesForgottenSchema.parse({ device_ids: [3], token: 'secret' })).toThrow()
  })
})
