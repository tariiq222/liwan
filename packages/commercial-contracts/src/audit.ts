import { z } from 'zod'

const searchText = z.string().trim().min(1).max(200)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'Invalid date')

export const AUDIT_PAGE_SIZE = 25

/**
 * GET /v1/audit query. `action` is an exact action or a family prefix (`order` matches `order.accepted`);
 * `subject` is the exact stored subject; `customer_id` matches the customer and everything owned by it
 * (workspace, subscriptions, orders). `from`/`to` are inclusive UTC calendar days.
 */
export const auditListQuerySchema = z.strictObject({
  q: searchText.optional(),
  action: z.string().regex(/^[a-z][a-z0-9_.]{0,99}$/).optional(),
  actor: searchText.optional(),
  subject: searchText.optional(),
  customer_id: z.uuid().optional(),
  from: day.optional(),
  to: day.optional(),
  page: z.string().regex(/^\d{1,5}$/).transform(Number).pipe(z.number().int().min(1).max(10000)).optional(),
}).refine(query => !query.from || !query.to || query.from <= query.to, { path: ['to'], message: 'The end day precedes the start day' })
export type AuditListQuery = z.infer<typeof auditListQuerySchema>

export const auditSubjectKindSchema = z.enum(['account', 'customer', 'tenant', 'order', 'plan', 'bundle', 'catalog', 'other'])
export type AuditSubjectKind = z.infer<typeof auditSubjectKindSchema>

/** What the stored subject string refers to; `name` is resolved server-side and null when the record is gone or unnamed. */
export const auditSubjectSchema = z.strictObject({
  kind: auditSubjectKindSchema, name: z.string().nullable(),
  customer_id: z.uuid().nullable(), tenant_id: z.uuid().nullable(),
})

export const auditEventSchema = z.strictObject({
  id: z.uuid(), actor: z.string(), actor_name: z.string().nullable(), action: z.string(), subject: z.string(),
  subject_ref: auditSubjectSchema, reason: z.string(), created_at: z.iso.datetime(),
})
export type AuditEvent = z.infer<typeof auditEventSchema>
export const auditListSchema = z.strictObject({ items: z.array(auditEventSchema), total: z.number().int().nonnegative() })
export type AuditList = z.infer<typeof auditListSchema>
