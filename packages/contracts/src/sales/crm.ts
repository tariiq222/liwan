import { z } from 'zod'

// The `liwan_sales_crm` bridge: the opportunity a quotation was made from, and the two settings that decide how an
// opportunity is won by an order. Every field here is optional in the Sales shapes that carry it, because the bridge
// adds it only while CRM is installed and included in the tenant's plan (R8, R10). The quotations of one opportunity
// (`GET /crm/opportunities/<id>/orders`) are read with `SalesOrderListSchema`, and the quotation made from one
// (`POST` on the same path, no body) answers with `SalesOrderSchema`.

/** When an order wins its opportunity: as soon as it is confirmed, or never (the agent wins it with a package). */
export const SalesOpportunityWinSchema = z.enum(['order_confirmed', 'manual'])
/** What the opportunity is won for, summed over its confirmed orders in the company's currency: untaxed or taxed. */
export const SalesOpportunityWinAmountSchema = z.enum(['untaxed', 'total'])

/** The settings of the bridge, read and written with the Sales settings; both are absent while the tenant has no CRM. */
export const SalesCrmSettingsShape = {
  opportunity_win: SalesOpportunityWinSchema,
  opportunity_win_amount: SalesOpportunityWinAmountSchema,
} as const

/** The opportunity of an order, named only to a caller who reads it in CRM; `status` is the opportunity's won status. */
export const SalesOrderOpportunitySchema = z.object({
  id: z.number().int().positive(),
  contact_name: z.string(),
  status: z.enum(['pending', 'won', 'lost']),
  // False for an archived opportunity.
  active: z.boolean(),
}).strict()

export type SalesOpportunityWin = z.infer<typeof SalesOpportunityWinSchema>
export type SalesOpportunityWinAmount = z.infer<typeof SalesOpportunityWinAmountSchema>
export type SalesOrderOpportunity = z.infer<typeof SalesOrderOpportunitySchema>
