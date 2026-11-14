import { z } from 'zod'
import { PersonRefSchema } from '../common/person'

// liwan_sales: staff quotations and orders on sale.order, plus the online orders other channels made, read-only here.
// Field for field with odoo-addons/liwan_sales/serializers. The wire never carries a price or a tax into a write: the
// server prices every product line from the product service.

const Id = z.number().int().positive()
const RefSchema = z.object({ id: Id, name: z.string() }).strict()
const Amount = z.number()
const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const SALES_LIMITS = { terms: 10_000, lineName: 2000, validityDays: 3650, discountPercent: 100 } as const

export const SalesOrderStateSchema = z.enum(['draft', 'sent', 'confirmed', 'cancelled'])
/** `staff` is a document of the sales service; `online` was made by another channel and is read-only in sales. */
export const SalesOrderSourceSchema = z.enum(['staff', 'online'])
export const SalesLineKindSchema = z.enum(['product', 'section', 'note'])
export const SalesVisibilitySchema = z.enum(['own', 'all'])

export const SalesCurrencySchema = z.object({ id: Id, name: z.string().min(1), symbol: z.string() }).strict()

/** A line as saved. Section and note lines carry a name and zero amounts. */
export const SalesOrderLineSchema = z.object({
  id: Id,
  kind: SalesLineKindSchema,
  product: RefSchema.nullable(),
  name: z.string(),
  quantity: z.number(),
  unit: z.string().nullable(),
  unit_price: Amount,
  discount_percent: z.number().min(0).max(100),
  amount_untaxed: Amount,
  amount_tax: Amount,
  amount_total: Amount,
}).strict()

/** What the caller may do with the document now; the record page shows exactly these. */
export const SalesOrderActionsSchema = z.object({
  edit: z.boolean(),
  confirm: z.boolean(),
  cancel: z.boolean(),
  reopen: z.boolean(),
  lock: z.boolean(),
  unlock: z.boolean(),
  duplicate: z.boolean(),
  assign: z.boolean(),
}).strict()

const OrderFields = {
  id: Id,
  number: z.string().min(1),
  state: SalesOrderStateSchema,
  locked: z.boolean(),
  source: SalesOrderSourceSchema,
  customer: RefSchema,
  salesperson: PersonRefSchema.nullable(),
  validity_date: IsoDay.nullable(),
  date: z.string().min(1),
  terms: z.string(),
  currency: SalesCurrencySchema,
  amount_untaxed: Amount,
  amount_tax: Amount,
  amount_total: Amount,
}

export const SalesOrderListItemSchema = z.object(OrderFields).strict()

export const SalesOrderSchema = z.object({
  ...OrderFields,
  lines: z.array(SalesOrderLineSchema),
  actions: SalesOrderActionsSchema,
}).strict()

export const SalesOrderListSchema = z.object({
  items: z.array(SalesOrderListItemSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** One line of a write. A product line needs `product_id` and a positive `quantity`; a section or note line a name. */
export const SalesOrderLineInputSchema = z.object({
  id: Id.optional(),
  kind: SalesLineKindSchema,
  product_id: Id.optional(),
  name: z.string().max(SALES_LIMITS.lineName).optional(),
  quantity: z.number().positive().optional(),
  discount_percent: z.number().min(0).max(SALES_LIMITS.discountPercent).optional(),
}).strict().superRefine((line, ctx) => {
  if (line.kind === 'product') {
    if (line.product_id === undefined) ctx.addIssue({ code: 'custom', path: ['product_id'], message: 'a product line needs a product' })
    if (line.quantity === undefined) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'a product line needs a quantity' })
  } else if (!line.name?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['name'], message: 'a section or note line needs a name' })
  }
})

const WriteFields = {
  // Honoured only for a holder of `sales.documents.assign`.
  salesperson_id: Id.optional(),
  validity_date: IsoDay.nullable().optional(),
  terms: z.string().max(SALES_LIMITS.terms).optional(),
  // The whole list in order: a line left out is removed.
  lines: z.array(SalesOrderLineInputSchema).optional(),
}

export const SalesOrderCreateSchema = z.object({ customer_id: Id, ...WriteFields }).strict()

export const SalesOrderPatchSchema = z.object({ customer_id: Id.optional(), ...WriteFields }).strict()
  .refine(patch => Object.keys(patch).length > 0, { message: 'nothing to change' })

/** The body of `POST /sales/orders/<id>/assign` (`sales.documents.assign`): the new salesperson of a staff document. */
export const SalesOrderAssignSchema = z.object({ salesperson_id: Id }).strict()

export const SalesSalespeopleSchema = z.object({
  items: z.array(PersonRefSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const SalesSettingsSchema = z.object({
  visibility: SalesVisibilitySchema,
  validity_days: z.number().int().nonnegative(),
  discount_limit_percent: z.number().int().min(0).max(100),
  default_terms: z.string(),
  revision: z.number().int().positive(),
  // Whether this session may change the settings: the capability, in the root company.
  can_manage: z.boolean(),
}).strict()

export const SalesSettingsPatchSchema = z.object({
  visibility: SalesVisibilitySchema.optional(),
  validity_days: z.number().int().nonnegative().max(SALES_LIMITS.validityDays).optional(),
  discount_limit_percent: z.number().int().min(0).max(100).optional(),
  default_terms: z.string().max(SALES_LIMITS.terms).optional(),
  revision: z.number().int().positive(),
}).strict().refine(patch => Object.keys(patch).some(key => key !== 'revision'), { message: 'nothing to change' })

export type SalesOrderState = z.infer<typeof SalesOrderStateSchema>
export type SalesOrderSource = z.infer<typeof SalesOrderSourceSchema>
export type SalesLineKind = z.infer<typeof SalesLineKindSchema>
export type SalesVisibility = z.infer<typeof SalesVisibilitySchema>
export type SalesCurrency = z.infer<typeof SalesCurrencySchema>
export type SalesOrderLine = z.infer<typeof SalesOrderLineSchema>
export type SalesOrderActions = z.infer<typeof SalesOrderActionsSchema>
export type SalesOrderListItem = z.infer<typeof SalesOrderListItemSchema>
export type SalesOrder = z.infer<typeof SalesOrderSchema>
export type SalesOrderList = z.infer<typeof SalesOrderListSchema>
export type SalesOrderLineInput = z.infer<typeof SalesOrderLineInputSchema>
export type SalesOrderCreate = z.infer<typeof SalesOrderCreateSchema>
export type SalesOrderPatch = z.infer<typeof SalesOrderPatchSchema>
export type SalesOrderAssign = z.infer<typeof SalesOrderAssignSchema>
export type SalesSalespeople = z.infer<typeof SalesSalespeopleSchema>
export type SalesSettings = z.infer<typeof SalesSettingsSchema>
export type SalesSettingsPatch = z.infer<typeof SalesSettingsPatchSchema>
