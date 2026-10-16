import { z } from 'zod'

export const vendorCapabilitySchema = z.enum(['vendor.read', 'vendor.tenants.manage', 'vendor.catalog.manage', 'vendor.operations.run', 'vendor.audit.read', 'vendor.pricing.manage', 'vendor.subscriptions.manage', 'vendor.billing.manage', 'vendor.accounts.manage'])
export type VendorCapability = z.infer<typeof vendorCapabilitySchema>

// Wire shapes of the vendor-admin identity routes (/v1/admin/auth/*, /v1/admin/me, /v1/admin/accounts*).
// The control plane builds every response through these schemas and the vendor-admin BFF parses with the
// same ones, so a field added or renamed on one side fails on the other. They are strict on purpose.

export const VENDOR_ROLES = ['owner', 'customer_success', 'finance', 'product', 'operations', 'support'] as const
export const vendorRoleSchema = z.enum(VENDOR_ROLES)
export type VendorRole = z.infer<typeof vendorRoleSchema>

export const adminAccountStatusSchema = z.enum(['enrolling', 'active', 'disabled'])
export type AdminAccountStatus = z.infer<typeof adminAccountStatusSchema>

const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape)
const instant = z.iso.datetime()
const reason = z.string().min(3).max(1000)

/** Field limits shared by the control plane's request validation and the BFF's pre-validation. */
export const adminAuthFields = {
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(256),
  totpCode: z.string().regex(/^\d{6}$/),
  challengeId: z.string().length(36),
  response: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 16384),
}

export const adminSessionResultSchema = strict({
  session: z.string().regex(/^[1-9][0-9]{0,15}\.[A-Za-z0-9_-]{43}$/),
  expires_at: instant,
  idle_expires_at: instant,
  recovery_codes: z.array(z.string().min(1)).min(1).optional(),
})
export type AdminSessionResult = z.infer<typeof adminSessionResultSchema>

export const adminMeSchema = strict({
  id: z.number().int().positive(),
  email: z.string(),
  display_name: z.string(),
  roles: z.array(vendorRoleSchema),
  capabilities: z.array(vendorCapabilitySchema),
})
export type AdminMe = z.infer<typeof adminMeSchema>

export const adminAccountItemSchema = strict({
  id: z.number().int().positive(),
  email: z.string(),
  display_name: z.string(),
  status: adminAccountStatusSchema,
  roles: z.array(vendorRoleSchema),
  passkeys: z.number().int().nonnegative(),
  last_seen_at: instant.nullable(),
})
export type AdminAccountItem = z.infer<typeof adminAccountItemSchema>
export const adminAccountListSchema = strict({ items: z.array(adminAccountItemSchema), total: z.number().int().nonnegative() })

const accountRoles = z.array(vendorRoleSchema).min(1).max(VENDOR_ROLES.length)
export const adminInviteBodySchema = strict({ email: z.string().min(3).max(254), display_name: z.string().min(1).max(120), roles: accountRoles, reason })
export const adminRolesBodySchema = strict({ roles: accountRoles, reason })
export const adminReasonBodySchema = strict({ reason })

export const adminInviteResultSchema = strict({ id: z.number().int().positive(), invitation_token: adminAuthFields.token, expires_at: instant })
export const adminResetResultSchema = strict({ invitation_token: adminAuthFields.token, expires_at: instant })
export type AdminInviteResult = z.infer<typeof adminInviteResultSchema>
export type AdminResetResult = z.infer<typeof adminResetResultSchema>
/** Role change and disable answer 204 with no body. */

export const adminInvitationInfoSchema = strict({ email: z.string(), purpose: z.enum(['enroll', 'reset']) })
export const adminChallengeResultSchema = strict({ challenge_id: adminAuthFields.challengeId, options: z.record(z.string(), z.unknown()) })
export const adminTotpEnrollmentSchema = strict({ totp_uri: z.string(), totp_box: z.string() })

export const ADMIN_ERROR_CODES = ['auth_failed', 'unauthorized', 'forbidden', 'not_found', 'conflict', 'invalid', 'rate_limited', 'last_owner', 'step_up_required', 'admin_unavailable'] as const
export const adminErrorCodeSchema = z.enum(ADMIN_ERROR_CODES)
export type AdminErrorCode = z.infer<typeof adminErrorCodeSchema>
export const adminErrorBodySchema = strict({ code: adminErrorCodeSchema, message: z.string().optional(), field: z.string().optional() })
export type AdminErrorBody = z.infer<typeof adminErrorBodySchema>

/** Request bodies of the unauthenticated-session routes, keyed by the path under /v1/admin/auth/. */
export const adminAuthBodies = {
  invitation: strict({ token: adminAuthFields.token }),
  'enroll/passkey/options': strict({ token: adminAuthFields.token }),
  'enroll/passkey/verify': strict({ token: adminAuthFields.token, challenge_id: adminAuthFields.challengeId, response: adminAuthFields.response, label: z.string().max(60) }),
  'enroll/totp': strict({ token: adminAuthFields.token }),
  'enroll/complete': strict({ token: adminAuthFields.token, password: adminAuthFields.password, totp_code: adminAuthFields.totpCode, totp_box: z.string().regex(/^[A-Za-z0-9+/]+=*$/).max(200) }),
  'passkey/options': strict({}),
  'passkey/verify': strict({ challenge_id: adminAuthFields.challengeId, response: adminAuthFields.response }),
  fallback: strict({ email: adminAuthFields.email, password: adminAuthFields.password, totp_code: adminAuthFields.totpCode }),
  recovery: strict({ email: adminAuthFields.email, password: adminAuthFields.password, recovery_code: z.string().length(14) }),
  'step-up/options': strict({}),
  'step-up/verify': strict({ challenge_id: adminAuthFields.challengeId, response: adminAuthFields.response }),
  'dev-login': strict({}),
  'dev-step-up': strict({}),
  logout: strict({}),
} as const

/** Success bodies of the routes that answer 200 with data, keyed like adminAuthBodies; the other routes answer 204. */
export const adminAuthResults = {
  invitation: adminInvitationInfoSchema,
  'enroll/passkey/options': adminChallengeResultSchema,
  'enroll/totp': adminTotpEnrollmentSchema,
  'enroll/complete': adminSessionResultSchema,
  'passkey/options': adminChallengeResultSchema,
  'passkey/verify': adminSessionResultSchema,
  fallback: adminSessionResultSchema,
  recovery: adminSessionResultSchema,
  'dev-login': adminSessionResultSchema,
  'step-up/options': adminChallengeResultSchema,
} as const
