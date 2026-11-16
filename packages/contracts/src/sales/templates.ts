import { z } from 'zod'

// Quotation templates of liwan_sales (stock `sale.order.template`): a named set of lines, a validity and terms that start a
// quotation. Field for field with odoo-addons/liwan_sales/serializers/template.py. A template holds no price, tax or
// discount: starting a quotation prices every product line at that moment.

const Id = z.number().int().positive()
const RefSchema = z.object({ id: Id, name: z.string() }).strict()

export const SALES_TEMPLATE_LIMITS = {
  name: 200, terms: 10_000, lineName: 2000, validityDays: 3650, lines: 500, quantity: 1_000_000,
} as const

export const SalesTemplateLineKindSchema = z.enum(['product', 'section', 'note'])

/** A line as saved. `usable` is false when its product can no longer start a quotation (archived, or of another company). */
export const SalesTemplateLineSchema = z.object({
  kind: SalesTemplateLineKindSchema,
  product: RefSchema.nullable(),
  name: z.string(),
  quantity: z.number(),
  usable: z.boolean(),
}).strict()

const TemplateFields = {
  id: Id,
  name: z.string().min(1),
  // Days a quotation started from the template stays valid; 0 leaves the tenant's setting in force.
  validity_days: z.number().int().min(0).max(SALES_TEMPLATE_LIMITS.validityDays),
  archived: z.boolean(),
  line_count: z.number().int().nonnegative(),
  // False when a product line can no longer start a quotation.
  usable: z.boolean(),
  // Whether the caller may edit, archive or restore it (`sales.settings.manage` in its company).
  can_manage: z.boolean(),
}

export const SalesTemplateItemSchema = z.object(TemplateFields).strict()

export const SalesTemplateSchema = z.object({
  ...TemplateFields,
  terms: z.string(),
  lines: z.array(SalesTemplateLineSchema),
}).strict()

export const SalesTemplateListSchema = z.object({
  items: z.array(SalesTemplateItemSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** One line of a write: a product line needs `product_id` and a positive `quantity`; a section or note line a name. */
export const SalesTemplateLineInputSchema = z.object({
  kind: SalesTemplateLineKindSchema,
  product_id: Id.optional(),
  name: z.string().max(SALES_TEMPLATE_LIMITS.lineName).optional(),
  quantity: z.number().positive().max(SALES_TEMPLATE_LIMITS.quantity).optional(),
}).strict().superRefine((line, ctx) => {
  if (line.kind === 'product') {
    if (line.product_id === undefined) ctx.addIssue({ code: 'custom', path: ['product_id'], message: 'a product line needs a product' })
    if (line.quantity === undefined) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'a product line needs a quantity' })
  } else {
    if (!line.name?.trim()) ctx.addIssue({ code: 'custom', path: ['name'], message: 'a section or note line needs a name' })
    if (line.product_id !== undefined || line.quantity !== undefined) ctx.addIssue({ code: 'custom', path: ['kind'], message: 'a section or note line holds no product or quantity' })
  }
})

const WriteFields = {
  validity_days: z.number().int().min(0).max(SALES_TEMPLATE_LIMITS.validityDays).optional(),
  terms: z.string().max(SALES_TEMPLATE_LIMITS.terms).optional(),
  // The whole list in order: a line left out is removed.
  lines: z.array(SalesTemplateLineInputSchema).max(SALES_TEMPLATE_LIMITS.lines).optional(),
}

export const SalesTemplateCreateSchema = z.object({ name: z.string().trim().min(1).max(SALES_TEMPLATE_LIMITS.name), ...WriteFields }).strict()

export const SalesTemplatePatchSchema = z.object({ name: z.string().trim().min(1).max(SALES_TEMPLATE_LIMITS.name).optional(), ...WriteFields }).strict()
  .refine(patch => Object.keys(patch).length > 0, { message: 'nothing to change' })

export type SalesTemplateLineKind = z.infer<typeof SalesTemplateLineKindSchema>
export type SalesTemplateLine = z.infer<typeof SalesTemplateLineSchema>
export type SalesTemplateItem = z.infer<typeof SalesTemplateItemSchema>
export type SalesTemplate = z.infer<typeof SalesTemplateSchema>
export type SalesTemplateList = z.infer<typeof SalesTemplateListSchema>
export type SalesTemplateLineInput = z.infer<typeof SalesTemplateLineInputSchema>
export type SalesTemplateCreate = z.infer<typeof SalesTemplateCreateSchema>
export type SalesTemplatePatch = z.infer<typeof SalesTemplatePatchSchema>
