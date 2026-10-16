import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CapabilitySchema, MeRoleSchema } from '../../access'
import { MeCommercialSchema, MePlatformSchema, MeSchema } from '../me'

const legacy = {
  id: 1, name: 'Test', login: 'test', email: '', lang: 'ar_001', tz: 'UTC',
  role: 'employee', company: { id: 1, name: 'Institution' },
  platform: {
    schema_version: 1, policy_revision: 3, state: 'active', valid_until: null,
    read_only: false, readable_features: ['pmo.enabled'], writable_features: ['pmo.enabled'],
  },
}

// Frozen pre-change me.ts wire shape from d194f93f, independent of current MeSchema.
// Access schemas are unchanged by this task; platform is copied, not imported here.
const PreviousMeSchema = z.object({
  id: z.number().int().positive(), name: z.string(), login: z.string(), email: z.string(),
  lang: z.string(), tz: z.string(), role: z.enum(['employee', 'admin', 'vendor']),
  roles: z.array(MeRoleSchema).optional().default([]),
  capabilities: z.array(CapabilitySchema).optional().default([]),
  access_policy_version: z.number().int().nonnegative().optional().default(0),
  company: z.object({ id: z.number().int().positive(), name: z.string() }),
  appearance: z.object({
    mode: z.enum(['light', 'cream', 'dark']), font_size: z.enum(['small', 'medium', 'large']),
  }).strict().optional(),
  modules: z.array(z.enum(['webvue_chat', 'webvue_hr', 'webvue_pmo'])).optional().default([]),
  entitlements: z.record(z.string(), z.union([z.boolean(), z.number().int().nonnegative().nullable()])).optional().default({}),
  platform: z.object({
    schema_version: z.literal(1), policy_revision: z.number().int().nonnegative(),
    state: z.enum(['active', 'suspended', 'expired']), valid_until: z.string().nullable(),
    read_only: z.boolean(), readable_features: z.array(z.string()), writable_features: z.array(z.string()),
  }).strict().optional(),
  terminology: z.object({
    ar: z.record(z.string(), z.string()), en: z.record(z.string(), z.string()),
  }).strict().optional().default({ ar: {}, en: {} }),
})

describe('optional commercial metadata compatibility', () => {
  it('accepts old payloads without guessing a mode or enabling self-service', () => {
    const result = MeSchema.parse(legacy)
    expect(result.commercial).toBeUndefined()
    expect(result.platform).toEqual(legacy.platform)
  })

  it.each(['saas', 'non_saas'] as const)('accepts %s with self-service disabled', (mode) => {
    const commercial = { schema_version: 1, mode, self_service_available: false }
    const payload = { ...legacy, commercial }
    expect(MeSchema.parse(payload).commercial).toEqual(commercial)
    expect(PreviousMeSchema.parse(payload)).toEqual(PreviousMeSchema.parse(legacy))
    expect(MeSchema.parse(payload).capabilities).toEqual([])
  })

  it.each([
    { schema_version: 1, mode: 'government', self_service_available: false },
    { schema_version: 2, mode: 'saas', self_service_available: false },
    { schema_version: 1, mode: 'non_saas', self_service_available: true },
    { schema_version: 1, mode: 'saas', self_service_available: true },
    { schema_version: 1, mode: 'saas', self_service_available: 'false' },
    { schema_version: 1, mode: 'saas' },
    { schema_version: 1, mode: 'saas', self_service_available: false, billing_token: 'forbidden' },
    null,
  ])('rejects unsupported or unsafe commercial shape: %j', (commercial) => {
    expect(MeCommercialSchema.safeParse(commercial).success).toBe(false)
    expect(MeSchema.safeParse({ ...legacy, commercial }).success).toBe(false)
  })

  it('keeps platform v1 strict and unchanged', () => {
    expect(MePlatformSchema.parse(legacy.platform)).toEqual(legacy.platform)
    expect(MePlatformSchema.safeParse({ ...legacy.platform, commercial_mode: 'saas' }).success).toBe(false)
  })
})
