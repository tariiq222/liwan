import { z } from 'zod'
import { PersonRefSchema } from '../common/person'
import { SalesCrmSettingsShape, SalesOrderOpportunitySchema } from './crm'
import { SalesFinanceSettingsShape, SalesOrderInvoicingSchema } from './finance'
import { SalesOrderPaymentSchema, SalesPaymentChoiceShape, SalesPaymentSettingsShape, SalesPublicPaymentSchema } from './payments'

export * from './crm'
export * from './finance'
export * from './payments'

// liwan_sales: staff quotations and orders on sale.order, plus the online orders other channels made, read-only here.
// Field for field with odoo-addons/liwan_sales/serializers. The wire never carries a price or a tax into a write: the
// server prices every product line from the product service.

const Id = z.number().int().positive()
const RefSchema = z.object({ id: Id, name: z.string() }).strict()
const Amount = z.number()
const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const SALES_LIMITS = {
  terms: 10_000, lineName: 2000, validityDays: 3650, discountPercent: 100, quantity: 1_000_000,
  // The public answer: the signer's name, the decline reason, and the drawn signature (a base64 PNG of at most 48 KB once decoded).
  signedBy: 120, declineReason: 1000, signatureBytes: 48 * 1024,
} as const

export const SalesOrderStateSchema = z.enum(['draft', 'sent', 'confirmed', 'cancelled'])
/** `staff` is a document of the sales service; `online` was made by another channel and is read-only in sales. */
export const SalesOrderSourceSchema = z.enum(['staff', 'online'])
export const SalesLineKindSchema = z.enum(['product', 'section', 'note'])
export const SalesVisibilitySchema = z.enum(['own', 'all'])
/** What a sent quotation lets the customer do: nothing, accept it, or accept it with a drawn signature and a name. */
export const SalesAnswerModeSchema = z.enum(['none', 'accept', 'accept_and_sign'])
export const SalesAnswerSchema = z.enum(['accepted', 'declined'])
/** Whether a quotation re-sent after the customer answered is allowed (the answer is then cleared) or refused. */
export const SalesAnsweredResendSchema = z.enum(['allow', 'refuse'])
/** How a signing customer may sign: by drawing only, or by drawing or by typing a name written as a signature. */
export const SalesSignatureMethodsSchema = z.enum(['draw', 'draw_or_type'])
/** How a signature was made: drawn by hand, or typed as a name. */
export const SalesSignatureMethodSchema = z.enum(['drawn', 'typed'])

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
  send: z.boolean(),
}).strict()

/** The customer's side of a sent quotation: the mode it was sent under and, once they answered, what they said. */
export const SalesCustomerAnswerSchema = z.object({
  mode: SalesAnswerModeSchema,
  // Whether an acceptance confirms the order by itself.
  acceptance_confirms: z.boolean(),
  answer: SalesAnswerSchema.nullable(),
  answered_at: z.string().nullable(),
  signed_by: z.string().nullable(),
  // Null while unsigned.
  signature_method: SalesSignatureMethodSchema.nullable(),
  decline_reason: z.string().nullable(),
}).strict()

const OrderFields = {
  id: Id,
  number: z.string().min(1),
  state: SalesOrderStateSchema,
  locked: z.boolean(),
  // The validity date has passed: the quotation can no longer be sent, confirmed or answered.
  expired: z.boolean(),
  source: SalesOrderSourceSchema,
  // Null until the quotation is first sent.
  customer_answer: SalesCustomerAnswerSchema.nullable(),
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
  // True when only the tenant's `answered_resend: refuse` keeps the caller from sending this answered quotation again.
  resend_refused: z.boolean(),
  // How the quotation asks to be paid; present only with the payments bridge, null while the tenant cannot take payments.
  payment: SalesOrderPaymentSchema.nullable().optional(),
  // The opportunity it was made from; present only with the CRM bridge, null for an order without one or one the caller cannot read in CRM.
  opportunity: SalesOrderOpportunitySchema.nullable().optional(),
  // The invoices of the order; present only with the finance bridge, null for a caller who cannot read finance invoices.
  invoicing: SalesOrderInvoicingSchema.nullable().optional(),
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
  quantity: z.number().positive().max(SALES_LIMITS.quantity).optional(),
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
  // How the quotation asks to be paid (the payments bridge); left out, a new quotation takes the tenant's default.
  ...SalesPaymentChoiceShape,
}

export const SalesOrderCreateSchema = z.object({ customer_id: Id, ...WriteFields }).strict()

export const SalesOrderPatchSchema = z.object({ customer_id: Id.optional(), ...WriteFields }).strict()
  .refine(patch => Object.keys(patch).length > 0, { message: 'nothing to change' })

/** The body of `POST /sales/orders/<id>/assign` (`sales.documents.assign`): the new salesperson of a staff document. */
export const SalesOrderAssignSchema = z.object({ salesperson_id: Id }).strict()

export const SalesSettingsSchema = z.object({
  visibility: SalesVisibilitySchema,
  validity_days: z.number().int().nonnegative(),
  discount_limit_percent: z.number().int().min(0).max(100),
  default_terms: z.string(),
  customer_answer: SalesAnswerModeSchema,
  acceptance_confirms: z.boolean(),
  answered_resend: SalesAnsweredResendSchema,
  signature_methods: SalesSignatureMethodsSchema,
  // The default way a new quotation asks to be paid (the payments bridge); both are absent while the tenant cannot take payments.
  payment_to_confirm: SalesPaymentSettingsShape.payment_to_confirm.optional(),
  prepayment_percent: SalesPaymentSettingsShape.prepayment_percent.optional(),
  // How an order wins its opportunity (the CRM bridge); both are absent while the tenant has no CRM.
  opportunity_win: SalesCrmSettingsShape.opportunity_win.optional(),
  opportunity_win_amount: SalesCrmSettingsShape.opportunity_win_amount.optional(),
  // Whether a confirmed order may be invoiced in advance, and who may invoice an order that is not theirs (the finance bridge);
  // both are absent while the tenant has no Finance.
  invoice_down_payment: SalesFinanceSettingsShape.invoice_down_payment.optional(),
  invoice_actor: SalesFinanceSettingsShape.invoice_actor.optional(),
  revision: z.number().int().positive(),
  // Whether this session may change the settings: the capability, in the root company.
  can_manage: z.boolean(),
}).strict()

export const SalesSettingsPatchSchema = z.object({
  visibility: SalesVisibilitySchema.optional(),
  validity_days: z.number().int().nonnegative().max(SALES_LIMITS.validityDays).optional(),
  discount_limit_percent: z.number().int().min(0).max(100).optional(),
  default_terms: z.string().max(SALES_LIMITS.terms).optional(),
  customer_answer: SalesAnswerModeSchema.optional(),
  acceptance_confirms: z.boolean().optional(),
  answered_resend: SalesAnsweredResendSchema.optional(),
  signature_methods: SalesSignatureMethodsSchema.optional(),
  payment_to_confirm: SalesPaymentSettingsShape.payment_to_confirm.optional(),
  prepayment_percent: SalesPaymentSettingsShape.prepayment_percent.optional(),
  opportunity_win: SalesCrmSettingsShape.opportunity_win.optional(),
  opportunity_win_amount: SalesCrmSettingsShape.opportunity_win_amount.optional(),
  invoice_down_payment: SalesFinanceSettingsShape.invoice_down_payment.optional(),
  invoice_actor: SalesFinanceSettingsShape.invoice_actor.optional(),
  revision: z.number().int().positive(),
}).strict().refine(patch => Object.keys(patch).some(key => key !== 'revision'), { message: 'nothing to change' })

/** A line as the customer reads it: no ids, and the unit as a display string. */
export const SalesPublicLineSchema = z.object({
  kind: SalesLineKindSchema,
  name: z.string(),
  quantity: z.number(),
  unit: z.string().nullable(),
  unit_price: Amount,
  discount_percent: z.number().min(0).max(100),
  amount_untaxed: Amount,
  amount_tax: Amount,
  amount_total: Amount,
}).strict()

/** What the holder of a quotation link reads (`/api/v1/public/sales/quotations/<id>`) and every answer to it returns. */
export const SalesPublicQuotationSchema = z.object({
  id: Id,
  number: z.string().min(1),
  state: z.enum(['sent', 'confirmed', 'cancelled']),
  expired: z.boolean(),
  company_name: z.string(),
  customer_name: z.string(),
  date: z.string().min(1),
  validity_date: IsoDay.nullable(),
  terms: z.string(),
  currency: SalesCurrencySchema,
  amount_untaxed: Amount,
  amount_tax: Amount,
  amount_total: Amount,
  lines: z.array(SalesPublicLineSchema),
  answer_mode: SalesAnswerModeSchema,
  // The signing methods in force when the quotation was sent; null only for an order that was never sent.
  signature_methods: SalesSignatureMethodsSchema.nullable(),
  answer: SalesAnswerSchema.nullable(),
  answered_at: z.string().nullable(),
  signed_by: z.string().nullable(),
  can_accept: z.boolean(),
  can_decline: z.boolean(),
  // Present only with the payments bridge; null when the quotation asks for no payment or the tenant cannot take one.
  payment: SalesPublicPaymentSchema.nullable().optional(),
}).strict()

const AccessToken = z.string().min(1).max(128)
const SIGNATURE_BASE64_MAX = Math.ceil(SALES_LIMITS.signatureBytes / 3) * 4

/**
 * The body of `POST .../quotations/<id>/accept`. In mode `accept_and_sign` the signer's name and the drawn signature
 * (base64 PNG, no `data:` prefix) and how the signature was made travel together; in mode `accept` none of them does.
 */
export const SalesQuotationAcceptSchema = z.object({
  access_token: AccessToken,
  signed_by: z.string().trim().min(1).max(SALES_LIMITS.signedBy).optional(),
  signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(SIGNATURE_BASE64_MAX).optional(),
  signature_method: SalesSignatureMethodSchema.optional(),
}).strict().refine(body => (body.signed_by === undefined) === (body.signature === undefined) && (body.signature === undefined) === (body.signature_method === undefined), { message: 'the name, the signature and its method come together' })

export const SalesQuotationDeclineSchema = z.object({
  access_token: AccessToken,
  reason: z.string().max(SALES_LIMITS.declineReason).optional(),
}).strict()

export type SalesOrderState = z.infer<typeof SalesOrderStateSchema>
export type SalesOrderSource = z.infer<typeof SalesOrderSourceSchema>
export type SalesLineKind = z.infer<typeof SalesLineKindSchema>
export type SalesVisibility = z.infer<typeof SalesVisibilitySchema>
export type SalesAnswerMode = z.infer<typeof SalesAnswerModeSchema>
export type SalesAnswer = z.infer<typeof SalesAnswerSchema>
export type SalesAnsweredResend = z.infer<typeof SalesAnsweredResendSchema>
export type SalesSignatureMethods = z.infer<typeof SalesSignatureMethodsSchema>
export type SalesSignatureMethod = z.infer<typeof SalesSignatureMethodSchema>
export type SalesCustomerAnswer = z.infer<typeof SalesCustomerAnswerSchema>
export type SalesPublicLine = z.infer<typeof SalesPublicLineSchema>
export type SalesPublicQuotation = z.infer<typeof SalesPublicQuotationSchema>
export type SalesQuotationAccept = z.infer<typeof SalesQuotationAcceptSchema>
export type SalesQuotationDecline = z.infer<typeof SalesQuotationDeclineSchema>
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
export type SalesSettings = z.infer<typeof SalesSettingsSchema>
export type SalesSettingsPatch = z.infer<typeof SalesSettingsPatchSchema>
