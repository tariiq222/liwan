import { z } from 'zod'

/** Wire contract between control-api (caller) and control-worker (executor) for the admin password effect. */
export const EFFECT_PATH = '/v1/internal/admin-password'
export const EFFECT_ISSUER = 'nasq-internal-effect'
export const EFFECT_ACTOR = 1
export const MAX_EFFECT_BODY = 4096
/** The worker gives the effect 200s; the API waits slightly longer so the worker's own refusal arrives first. */
export const WORKER_EFFECT_TIMEOUT_MS = 200000
export const API_EFFECT_TIMEOUT_MS = 215000

export const effectRequestSchema = z.strictObject({
  tenant_id: z.uuid(),
  admin_login: z.string().min(1).max(254),
  password: z.string().min(12).max(256),
  token: z.string().min(20).max(200),
})
export type EffectRequest = z.infer<typeof effectRequestSchema>

export const EFFECT_CODES = ['user_missing', 'user_inactive', 'password_policy', 'database_invalid', 'script_failed', 'busy', 'unavailable'] as const
export type EffectCode = (typeof EFFECT_CODES)[number]
export const isEffectCode = (value: unknown): value is EffectCode => typeof value === 'string' && (EFFECT_CODES as readonly string[]).includes(value)
