import { z } from 'zod'

export const branchKindSchema = z.enum(['hq', 'extra'])
export const branchBillingSchema = z.enum(['included', 'free_extra', 'paid'])
export const branchStateSchema = z.enum(['pending', 'active', 'archived', 'failed'])
export const branchSchema = z.strictObject({
  id: z.uuid(), subscription_id: z.string().min(1), tenant_id: z.string().min(1),
  name: z.string().trim().min(1).max(200), kind: branchKindSchema, billing: branchBillingSchema,
  state: branchStateSchema, odoo_company_id: z.number().int().positive().nullable(),
  order_id: z.string().nullable(), activated_at: z.string().nullable(), archived_at: z.string().nullable(),
})
export const branchSummarySchema = z.strictObject({
  items: z.array(branchSchema), total: z.number().int().min(0), hq: z.literal(1),
  free_extra_used: z.number().int().min(0), free_extra_allowed: z.number().int().min(0),
  paid: z.number().int().min(0), limit: z.number().int().min(0).nullable(),
})
export const branchQuoteRequestSchema = z.strictObject({
  subscription_id: z.string().min(1), expected_subscription_revision: z.number().int().min(0),
  add: z.array(z.strictObject({ name: z.string().trim().min(1).max(200) })).max(100),
  archive: z.array(z.uuid()).max(100),
  restore: z.array(z.uuid()).max(100).default([]),
}).refine(r => r.add.length + r.archive.length + r.restore.length > 0, { path: ['add'], message: 'Nothing requested' })

export type Branch = z.infer<typeof branchSchema>
export type BranchSummary = z.infer<typeof branchSummarySchema>
export type BranchQuoteRequest = z.infer<typeof branchQuoteRequestSchema>

export type BranchCounts = { hq: 1; extra_active: number; free_used: number; paid: number }
/**
 * Capacity-reservation counts. HQ is never counted against extras. Extras in `pending` AND `active`
 * state reserve capacity (plan B4); archived/failed do not. First `included_free` reserved extras are free.
 */
export function branchBillingCounts(branches: Pick<Branch, 'kind' | 'state'>[], included_free: number): BranchCounts {
  const extra_active = branches.filter(b => b.kind === 'extra' && (b.state === 'active' || b.state === 'pending')).length
  const free = Math.max(0, included_free)
  const free_used = Math.min(extra_active, free)
  return { hq: 1, extra_active, free_used, paid: extra_active - free_used }
}
