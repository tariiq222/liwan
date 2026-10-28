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
