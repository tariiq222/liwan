import { z } from 'zod'

const count = z.number().int().min(0)

const WonThisMonthSchema = z.strictObject({ count, value: z.number().min(0) })

export const CrmDashboardAgentSchema = z.strictObject({
  due_now: count,
  new_today: count,
  won_this_month: WonThisMonthSchema,
})

export const CrmDashboardSourceSchema = z.strictObject({
  source_id: z.number().int().nullable(),
  name: z.string(),
  total: count,
  won: count,
})

export const CrmDashboardAgentRowSchema = z.strictObject({
  user_id: z.number().int(),
  name: z.string(),
  open: count,
  won: count,
  due: count,
})

export const CrmDashboardManagerSchema = z.strictObject({
  unassigned: count,
  needs_manager: count,
  due_follow_ups: count,
  won_this_month: WonThisMonthSchema,
  conversion_by_source: z.array(CrmDashboardSourceSchema),
  agents: z.array(CrmDashboardAgentRowSchema),
})

export const CrmDashboardSchema = z.strictObject({
  agent: CrmDashboardAgentSchema,
  manager: CrmDashboardManagerSchema.nullable(),
})

export type CrmDashboard = z.infer<typeof CrmDashboardSchema>
