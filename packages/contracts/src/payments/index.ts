import { z } from 'zod'

export const PaymentProviderCodeSchema = z.enum(['paymob'])
export const PaymentProviderStateSchema = z.enum(['disabled', 'test', 'enabled'])

/** One credential field of the tenant's gateway account. Only its presence travels; the value never does. */
export const PaymentProviderCredentialSchema = z.object({
  field: z.string().min(1),
  present: z.boolean(),
}).strict()

/** A gateway the tenant connects with its own merchant account. */
export const PaymentProviderSchema = z.object({
  id: z.number().int().positive(),
  code: PaymentProviderCodeSchema,
  name: z.string().min(1),
  state: PaymentProviderStateSchema,
  credentials: z.array(PaymentProviderCredentialSchema),
  configured: z.boolean(),
  methods: z.array(z.string().min(1)),
  /** Country of the tenant's merchant account (ISO code); it decides the gateway currency. */
  account_country: z.string().length(2).nullable(),
  account_country_options: z.array(z.string().length(2)),
}).strict()

export const PaymentProviderListSchema = z.object({
  items: z.array(PaymentProviderSchema),
  total: z.number().int().nonnegative(),
}).strict()

/**
 * PATCH body: switch the mode, enter credentials, choose the account country, or several at once.
 * Credentials are write-only. While the gateway is on, the server re-checks it in the same request.
 */
export const PaymentProviderUpdateSchema = z.object({
  state: PaymentProviderStateSchema.optional(),
  credentials: z.record(z.string().min(1), z.string().trim().min(1).max(512))
    .refine(values => Object.keys(values).length > 0, { message: 'enter at least one credential' })
    .optional(),
  account_country: z.string().length(2).optional(),
}).strict().refine(body => Object.keys(body).length > 0, {
  message: 'state, credentials or account_country is required',
})

/** `methods_missing`: the gateway account lacks a payment method the provider needs. */
export const PaymentProviderSyncStatusSchema = z.enum(['synced', 'methods_missing'])

export const PaymentProviderSyncSchema = z.object({
  provider: PaymentProviderSchema,
  status: PaymentProviderSyncStatusSchema,
}).strict()

export type PaymentProviderCode = z.infer<typeof PaymentProviderCodeSchema>
export type PaymentProviderState = z.infer<typeof PaymentProviderStateSchema>
export type PaymentProviderCredential = z.infer<typeof PaymentProviderCredentialSchema>
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>
export type PaymentProviderList = z.infer<typeof PaymentProviderListSchema>
export type PaymentProviderUpdate = z.infer<typeof PaymentProviderUpdateSchema>
export type PaymentProviderSyncStatus = z.infer<typeof PaymentProviderSyncStatusSchema>
export type PaymentProviderSync = z.infer<typeof PaymentProviderSyncSchema>

/** One way the payer may pay: a gateway the tenant switched on and one of its payment methods. */
export const PaymentOptionSchema = z.object({
  provider_id: z.number().int().positive(),
  provider: z.string().min(1),
  method_id: z.number().int().positive(),
  method: z.string().min(1),
  method_name: z.string().min(1),
}).strict()

/** The two documents a pay link names: a posted customer invoice, or an order the customer pays online. */
export const PayDocumentKindSchema = z.enum(['invoice', 'order'])

export const PayableStatusSchema = z.enum(['payable', 'processing', 'paid', 'not_payable'])

/**
 * What the holder of a document's access token sees on the public pay page. No partner name or
 * address; `options` is empty unless the document is payable. `amount_due` is what is paid now.
 */
const PayableDocumentShape = {
  id: z.number().int().positive(),
  merchant: z.string().min(1),
  number: z.string().min(1),
  currency: z.string().length(3),
  amount_total: z.number(),
  amount_due: z.number(),
  status: PayableStatusSchema,
  options: z.array(PaymentOptionSchema),
}

export const PayableInvoiceSchema = z.object({
  ...PayableDocumentShape,
  due_date: z.string().nullable(),
}).strict()

/** An online order: all of it or a deposit is paid now; unpaid at `expires_at`, it is cancelled. */
export const PayableOrderSchema = z.object({
  ...PayableDocumentShape,
  expires_at: z.string().datetime().nullable(),
}).strict()

/** POST body that starts a payment. The amount, currency and payer always come from the document. */
export const PaymentStartSchema = z.object({
  access_token: z.string().min(1).max(128),
  provider_id: z.number().int().positive(),
  payment_method_id: z.number().int().positive(),
}).strict()

/** The gateway page the browser must open: navigate for `get`, submit a form for `post`. */
export const PaymentRedirectSchema = z.object({
  redirect: z.object({
    method: z.enum(['get', 'post']),
    url: z.string().url(),
    fields: z.record(z.string(), z.string()),
  }).strict(),
}).strict()

export const PaymentLinkCreateSchema = z.object({
  invoice_id: z.number().int().positive(),
}).strict()

/** A path, not a URL: the browser that shows it knows the tenant's public origin. */
export const PaymentLinkSchema = z.object({
  path: z.string().regex(/^\/pay\/(invoice|order)\/\d+\?access_token=[\w-]+$/),
}).strict()

export type PaymentOption = z.infer<typeof PaymentOptionSchema>
export type PayDocumentKind = z.infer<typeof PayDocumentKindSchema>
export type PayableStatus = z.infer<typeof PayableStatusSchema>
export type PayableInvoice = z.infer<typeof PayableInvoiceSchema>
export type PayableOrder = z.infer<typeof PayableOrderSchema>
export type PaymentStart = z.infer<typeof PaymentStartSchema>
export type PaymentRedirect = z.infer<typeof PaymentRedirectSchema>
export type PaymentLinkCreate = z.infer<typeof PaymentLinkCreateSchema>
export type PaymentLink = z.infer<typeof PaymentLinkSchema>

/** Inclusive bounds of the unpaid-order expiry, in minutes. */
export const PAYMENT_ORDER_EXPIRY_MINUTES = { min: 5, max: 1440 } as const

const OrderExpiryMinutesSchema = z.number().int()
  .min(PAYMENT_ORDER_EXPIRY_MINUTES.min).max(PAYMENT_ORDER_EXPIRY_MINUTES.max)

/**
 * What a customer who cancels gets back of what they paid: all of it, a percent by how long before the
 * service they cancel (the product's notice tiers), or nothing. Money that arrives by mistake (a payment
 * after cancellation or expiry, a second payment) is always refunded in full. A company default is
 * `full` or `none`; a product may use `notice`, or `company` to keep the default.
 */
export const RefundPolicySchema = z.enum(['full', 'notice', 'none'])
export const CompanyRefundPolicySchema = z.enum(['full', 'none'])
/** How much one recorded refund may be: the whole amount due at once (`due`), or any part of it (`any`). */
export const RefundAmountsSchema = z.enum(['due', 'any'])

/**
 * The payments settings. `unpaid_order_expiry_minutes` belongs to the current company (default 60);
 * `invoice_when_paid` is one choice for the whole tenant (default on): stock invoices and posts a
 * paid online order at once. `refund_policy` (default `full`) and `refund_amounts` (default `due`)
 * are the refund rules of the company's products that keep the company default. `revision` is the
 * company's saved revision, 0 while it uses the defaults.
 */
export const PaymentSettingsSchema = z.object({
  unpaid_order_expiry_minutes: OrderExpiryMinutesSchema,
  invoice_when_paid: z.boolean(),
  refund_policy: CompanyRefundPolicySchema,
  refund_amounts: RefundAmountsSchema,
  revision: z.number().int().nonnegative(),
}).strict()

/** PATCH body: the revision the change was made on, and the settings to change. */
export const PaymentSettingsUpdateSchema = z.object({
  revision: z.number().int().nonnegative(),
  unpaid_order_expiry_minutes: OrderExpiryMinutesSchema.optional(),
  invoice_when_paid: z.boolean().optional(),
  refund_policy: CompanyRefundPolicySchema.optional(),
  refund_amounts: RefundAmountsSchema.optional(),
}).strict()

export type RefundPolicy = z.infer<typeof RefundPolicySchema>
export type CompanyRefundPolicy = z.infer<typeof CompanyRefundPolicySchema>
export type RefundAmounts = z.infer<typeof RefundAmountsSchema>
export type PaymentSettings = z.infer<typeof PaymentSettingsSchema>
export type PaymentSettingsUpdate = z.infer<typeof PaymentSettingsUpdateSchema>

/** Inclusive bounds of a notice tier, and how many tiers a product may have. */
export const REFUND_NOTICE_HOURS = { min: 0, max: 8760 } as const
export const REFUND_MAX_TIERS = 5

/** A customer who cancels at least `notice_hours` before the service gets `percent` of what they paid back. */
export const RefundTierSchema = z.object({
  notice_hours: z.number().int().min(REFUND_NOTICE_HOURS.min).max(REFUND_NOTICE_HOURS.max),
  percent: z.number().int().min(0).max(100),
}).strict()

const uniqueNotice = (tiers: { notice_hours: number }[]) => new Set(tiers.map(tier => tier.notice_hours)).size === tiers.length

/**
 * The refund rules of a product a selling application sells. The tier with the largest notice not above
 * the notice given applies; less notice than every tier refunds nothing; `notice` needs at least one tier.
 */
export const RefundTiersSchema = z.array(RefundTierSchema).max(REFUND_MAX_TIERS).refine(uniqueNotice, { message: 'one tier per notice' })

export const RefundRulesSchema = z.object({
  refund_policy: z.union([RefundPolicySchema, z.literal('company')]),
  refund_amounts: z.union([RefundAmountsSchema, z.literal('company')]),
  refund_tiers: RefundTiersSchema,
}).strict()

export type RefundTier = z.infer<typeof RefundTierSchema>
export type RefundRules = z.infer<typeof RefundRulesSchema>

/**
 * An online order as the company's payments staff see it (`payments.orders.read`). `status` is the
 * payer's status, or `cancelled`. `amount_received` is what it received less its refunds;
 * `amount_to_refund` what it must give back. `needs_attention`: money was received but has not been
 * recorded on the order for an hour, so a person must look at it.
 */
export const PaymentOrderStatusSchema = z.enum(['payable', 'processing', 'paid', 'not_payable', 'cancelled'])

export const PaymentOrderItemSchema = z.object({
  id: z.number().int().positive(),
  number: z.string(),
  customer: z.string(),
  date: z.string().datetime(),
  status: PaymentOrderStatusSchema,
  needs_attention: z.boolean(),
  currency: z.string().length(3),
  amount_total: z.number(),
  amount_due: z.number(),
  amount_received: z.number(),
  amount_to_refund: z.number().nonnegative(),
  expires_at: z.string().datetime().nullable(),
}).strict()

export const PaymentOrderListSchema = z.object({
  items: z.array(PaymentOrderItemSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** List filters: `state` is `open` (unpaid quotation), `confirmed` or `cancelled`. */
export const PaymentOrderStateFilterSchema = z.enum(['open', 'confirmed', 'cancelled'])

export const PaymentTransactionStateSchema = z.enum(['draft', 'pending', 'authorized', 'done', 'cancel', 'error'])

/** One money move of an order: a payment, or a refund of one; `reference` is the gateway's. */
export const PaymentOrderTransactionSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['payment', 'refund']),
  state: PaymentTransactionStateSchema,
  amount: z.number().nonnegative(),
  provider: z.string(),
  reference: z.string(),
  date: z.string().datetime().nullable(),
}).strict()

/** The staff order page; `partial_refunds` says whether one refund may be less than the amount due. */
export const PaymentOrderDetailSchema = PaymentOrderItemSchema.extend({
  lines: z.array(z.object({ name: z.string(), quantity: z.number(), amount: z.number() }).strict()),
  transactions: z.array(PaymentOrderTransactionSchema),
  partial_refunds: z.boolean(),
}).strict()

/** The gateway refund reference a refund is recorded under, at most this long. */
export const REFUND_REFERENCE_MAX_LENGTH = 128

/**
 * POST body of a refund the tenant already made in its gateway dashboard (`payments.refund`): at most the
 * amount due, and all of it unless `partial_refunds`. The answer is the order page.
 */
export const PaymentRefundCreateSchema = z.object({
  amount: z.number().positive(),
  reference: z.string().trim().min(1).max(REFUND_REFERENCE_MAX_LENGTH),
}).strict()

export type PaymentOrderStatus = z.infer<typeof PaymentOrderStatusSchema>
export type PaymentOrderItem = z.infer<typeof PaymentOrderItemSchema>
export type PaymentOrderList = z.infer<typeof PaymentOrderListSchema>
export type PaymentOrderStateFilter = z.infer<typeof PaymentOrderStateFilterSchema>
export type PaymentTransactionState = z.infer<typeof PaymentTransactionStateSchema>
export type PaymentOrderTransaction = z.infer<typeof PaymentOrderTransactionSchema>
export type PaymentOrderDetail = z.infer<typeof PaymentOrderDetailSchema>
export type PaymentRefundCreate = z.infer<typeof PaymentRefundCreateSchema>

/**
 * The payer's way back from the gateway. Before leaving for the gateway page, the pay page stores
 * `<kind>.<document id>.<access token>` in this cookie (path `/payment`, one hour); the gateway's
 * return lands on `/payment/<code>/return`, where the server reads it to send the payer to the
 * status page of that document.
 */
export const PAY_RETURN_COOKIE = 'webvue_pay_return'
export const PAY_RETURN_COOKIE_PATH = '/payment'
export const PAY_RETURN_MAX_AGE_SECONDS = 3600
const PAY_RETURN_VALUE = /^(invoice|order)\.(\d{1,12})\.([A-Za-z0-9_-]{1,128})$/

/** The document a pay page names: its kind, id and access token. */
export interface PayReturn {
  kind: PayDocumentKind
  id: number
  accessToken: string
}

export function encodePayReturn(back: PayReturn): string {
  return `${back.kind}.${back.id}.${back.accessToken}`
}

/** The document of a well-formed cookie value, or null. */
export function decodePayReturn(value: string | undefined | null): PayReturn | null {
  const match = value ? PAY_RETURN_VALUE.exec(value) : null
  return match ? { kind: match[1] as PayDocumentKind, id: Number(match[2]), accessToken: match[3]! } : null
}
