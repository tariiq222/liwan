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
  webhook_url: z.string().url(),
}).strict()

export const PaymentProviderListSchema = z.object({
  items: z.array(PaymentProviderSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** PATCH body: switch the mode, enter credentials, or both. Credentials are write-only. */
export const PaymentProviderUpdateSchema = z.object({
  state: PaymentProviderStateSchema.optional(),
  credentials: z.record(z.string().min(1), z.string().trim().min(1).max(512)).optional(),
}).strict().refine(body => body.state !== undefined || body.credentials !== undefined, {
  message: 'state or credentials is required',
})

export const PaymentProviderSyncStatusSchema = z.enum(['synced', 'partial'])

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
