import { z } from 'zod'

export const MailDomainStateSchema = z.enum(['not_started', 'pending_dns', 'verified', 'failed'])
export const MailDnsRecordKindSchema = z.enum(['dkim', 'spf', 'return_path'])
export const MailDnsRecordTypeSchema = z.enum(['CNAME', 'TXT'])

/** One DNS record the tenant adds at its own DNS host. */
export const MailDnsRecordSchema = z.object({
  kind: MailDnsRecordKindSchema,
  type: MailDnsRecordTypeSchema,
  name: z.string().min(1),
  value: z.string().min(1),
}).strict()

/** The tenant's sending domain: its verification state, the records to publish and any pause. */
export const MailDomainSchema = z.object({
  state: MailDomainStateSchema,
  domain: z.string().min(1).nullable(),
  from_local_part: z.string().min(1).nullable(),
  sender_address: z.string().min(1).nullable(),
  records: z.array(MailDnsRecordSchema),
  /** When the pending return path expires on the provider's side (ISO). */
  return_path_expires_at: z.string().min(1).nullable(),
  /** When the server last recreated an expired return path on its own (ISO). */
  return_path_recreated_at: z.string().min(1).nullable(),
  verified_at: z.string().min(1).nullable(),
  last_error: z.string().min(1).nullable(),
  paused: z.boolean(),
  pause_reason: z.string().min(1).nullable(),
  provider_configured: z.boolean(),
}).strict()

/** POST /start body. */
export const MailDomainStartSchema = z.object({
  domain: z.string().trim().min(1).max(253),
  from_local_part: z.string().trim().min(1).max(64),
}).strict()

export const MailTestSendSchema = z.object({
  mail_id: z.number().int().positive(),
  state: z.string().min(1),
}).strict()

/** Today's sending against the protection ceiling; the screen shows it only near the ceiling. */
export const MailUsageSchema = z.object({
  today: z.number().int().nonnegative(),
  ceiling: z.number().int().nonnegative(),
  near_ceiling: z.boolean(),
  deferred: z.number().int().nonnegative(),
}).strict()

export type MailDomainState = z.infer<typeof MailDomainStateSchema>
export type MailDnsRecord = z.infer<typeof MailDnsRecordSchema>
export type MailDomain = z.infer<typeof MailDomainSchema>
export type MailDomainStart = z.infer<typeof MailDomainStartSchema>
export type MailTestSend = z.infer<typeof MailTestSendSchema>
export type MailUsage = z.infer<typeof MailUsageSchema>
