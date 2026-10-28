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

export const PayableInvoiceStatusSchema = z.enum(['payable', 'processing', 'paid', 'not_payable'])

/**
 * What the holder of an invoice's access token sees on the public pay page. No partner name or
 * address; `options` is empty unless the invoice is payable.
 */
export const PayableInvoiceSchema = z.object({
  id: z.number().int().positive(),
  merchant: z.string().min(1),
  number: z.string().min(1),
  due_date: z.string().nullable(),
  currency: z.string().length(3),
  amount_total: z.number(),
  amount_due: z.number(),
  status: PayableInvoiceStatusSchema,
  options: z.array(PaymentOptionSchema),
}).strict()

/** POST body that starts a payment. The amount, currency and payer always come from the invoice. */
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
  path: z.string().regex(/^\/pay\/invoice\/\d+\?access_token=[\w-]+$/),
}).strict()

export type PaymentOption = z.infer<typeof PaymentOptionSchema>
export type PayableInvoiceStatus = z.infer<typeof PayableInvoiceStatusSchema>
export type PayableInvoice = z.infer<typeof PayableInvoiceSchema>
export type PaymentStart = z.infer<typeof PaymentStartSchema>
export type PaymentRedirect = z.infer<typeof PaymentRedirectSchema>
export type PaymentLinkCreate = z.infer<typeof PaymentLinkCreateSchema>
export type PaymentLink = z.infer<typeof PaymentLinkSchema>
