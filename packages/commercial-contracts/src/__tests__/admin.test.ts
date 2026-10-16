import { describe, expect, it } from 'vitest'
import {
  adminAccountItemSchema, adminAccountListSchema, adminAuthBodies, adminAuthResults, adminErrorBodySchema, adminInviteBodySchema, adminInviteResultSchema,
  adminMeSchema, adminResetResultSchema, adminSessionResultSchema, vendorRoleSchema, VENDOR_ROLES,
} from '../index'

const token = 'A'.repeat(43)
const at = '2026-11-01T10:00:00.000Z'
const samples = {
  session: { value: { session: `7.${token}`, expires_at: at, idle_expires_at: at }, schema: adminSessionResultSchema },
  me: { value: { id: 7, email: 'a@nasq.sa', display_name: 'A', roles: ['owner'], capabilities: ['vendor.read'] }, schema: adminMeSchema },
  item: { value: { id: 7, email: 'a@nasq.sa', display_name: 'A', status: 'active', roles: ['support'], passkeys: 1, last_seen_at: null }, schema: adminAccountItemSchema },
  list: { value: { items: [], total: 0 }, schema: adminAccountListSchema },
  invite: { value: { id: 7, invitation_token: token, expires_at: at }, schema: adminInviteResultSchema },
  reset: { value: { invitation_token: token, expires_at: at }, schema: adminResetResultSchema },
  error: { value: { code: 'not_found' }, schema: adminErrorBodySchema },
} as const

describe('vendor-admin identity contracts', () => {
  it('accepts the documented shape of every response', () => {
    for (const { value, schema } of Object.values(samples)) expect(schema.safeParse(value).success).toBe(true)
  })
  it('refuses a field added on one side only', () => {
    for (const { value, schema } of Object.values(samples)) expect(schema.safeParse({ ...value, added_by_one_side: 1 }).success).toBe(false)
  })
  it('refuses a field renamed on one side only', () => {
    for (const { value, schema } of Object.values(samples)) {
      for (const key of Object.keys(value)) {
        const { [key]: kept, ...rest } = value as Record<string, unknown>
        expect(schema.safeParse({ ...rest, [`${key}_renamed`]: kept }).success).toBe(false)
      }
    }
  })
  it('shares one role vocabulary across responses and request bodies', () => {
    expect(vendorRoleSchema.options).toEqual([...VENDOR_ROLES])
    expect(adminInviteBodySchema.safeParse({ email: 'a@nasq.sa', display_name: 'A', roles: ['god'], reason: 'new hire' }).success).toBe(false)
    expect(adminMeSchema.safeParse({ ...samples.me.value, roles: ['god'] }).success).toBe(false)
    expect(adminAccountItemSchema.safeParse({ ...samples.item.value, status: 'gone' }).success).toBe(false)
  })
  it('keeps recovery codes optional and never empty', () => {
    expect(adminSessionResultSchema.safeParse({ ...samples.session.value, recovery_codes: Array(10).fill('aaaa-bbbb-cccc') }).success).toBe(true)
    expect(adminSessionResultSchema.safeParse({ ...samples.session.value, recovery_codes: [] }).success).toBe(false)
  })
  it('describes a success body for every route that is not 204', () => {
    expect(Object.keys(adminAuthResults).every((route) => route in adminAuthBodies)).toBe(true)
    expect(adminAuthResults.fallback).toBe(adminSessionResultSchema)
    expect(adminAuthResults['dev-login']).toBe(adminSessionResultSchema)
  })
  it('takes an empty body for the developer sign-in routes', () => {
    for (const route of ['dev-login', 'dev-step-up'] as const) {
      expect(adminAuthBodies[route].safeParse({}).success).toBe(true)
      expect(adminAuthBodies[route].safeParse({ email: 'a@nasq.sa' }).success).toBe(false)
    }
  })
  it('declares strict bodies for every auth route', () => {
    for (const schema of Object.values(adminAuthBodies)) expect(schema.safeParse({ unexpected: true }).success).toBe(false)
    expect(adminAuthBodies.fallback.safeParse({ email: 'a@nasq.sa', password: 'x', totp_code: '123456' }).success).toBe(true)
  })
})
