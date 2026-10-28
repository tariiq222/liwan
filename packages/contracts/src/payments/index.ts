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
 * The payments settings. `unpaid_order_expiry_minutes` belongs to the current company (default 60);
 * `invoice_when_paid` is one choice for the whole tenant (default on): stock invoices and posts a
 * paid online order at once. `revision` is the company's saved revision, 0 while it uses the defaults.
 */
export const PaymentSettingsSchema = z.object({
  unpaid_order_expiry_minutes: OrderExpiryMinutesSchema,
  invoice_when_paid: z.boolean(),
  revision: z.number().int().nonnegative(),
}).strict()

/** PATCH body: the revision the change was made on, and the settings to change. */
export const PaymentSettingsUpdateSchema = z.object({
  revision: z.number().int().nonnegative(),
  unpaid_order_expiry_minutes: OrderExpiryMinutesSchema.optional(),
  invoice_when_paid: z.boolean().optional(),
}).strict()

export type PaymentSettings = z.infer<typeof PaymentSettingsSchema>
export type PaymentSettingsUpdate = z.infer<typeof PaymentSettingsUpdateSchema>

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
