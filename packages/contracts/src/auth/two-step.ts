import { z } from 'zod'

/** The delivery channel of a sign-in code. Email is always offered; SMS needs a configured provider. */
export const LoginChannelSchema = z.enum(['sms', 'email'])
export type LoginChannel = z.infer<typeof LoginChannelSchema>

/** What a pending sign-in may use (GET /auth/channels). */
export const LoginChannelsSchema = z.object({
  channels: z.array(LoginChannelSchema),
  sms_available: z.boolean(),
  has_mobile: z.boolean(),
  has_email: z.boolean(),
}).strict()
export type LoginChannels = z.infer<typeof LoginChannelsSchema>

/** Sending a code (POST /auth/code). `destination` is already masked by the server. */
export const LoginCodeRequestSchema = z.object({ channel: LoginChannelSchema }).strict()
export const LoginCodeSentSchema = z.object({
  channel: LoginChannelSchema,
  destination: z.string().min(1),
  resend_after: z.number().int().nonnegative(),
}).strict()
export type LoginCodeSent = z.infer<typeof LoginCodeSentSchema>

/** Finishing a sign-in (POST /auth/verify). The code is six digits; the server normalizes Arabic-Indic ones. */
export const LOGIN_CODE_LENGTH = 6
export const LoginVerifySchema = z.object({
  code: z.string().min(1).max(16),
  remember: z.boolean().optional(),
  label: z.string().max(80).optional(),
}).strict()
export type LoginVerify = z.infer<typeof LoginVerifySchema>

/** Every machine code the second step can answer with, so the page maps each to its own sentence. */
export const DOUBLE_STEP_ERROR_CODES = [
  'invalid_code',
  'invalid_code_format',
  'invalid_device',
  'no_pending_login',
  'resend_cooldown',
  'send_limit_reached',
  'daily_send_cap',
  'channel_unavailable',
  'invalid_channel',
  'tenant_suspended',
  'login_refused',
  'invalid_credentials',
] as const
export type DoubleStepErrorCode = typeof DOUBLE_STEP_ERROR_CODES[number]
