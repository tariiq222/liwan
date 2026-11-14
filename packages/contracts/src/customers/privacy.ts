import { z } from 'zod'

// liwan_customers privacy routes (PDPL): the erase preview, the erase and the subject export of one customer.
// Field for field with odoo-addons/liwan_customers/serializers/privacy.py. Keys and reasons stay open strings: an
// application adds its own item keys, not-covered keys and refusal reasons without a contract change.

/** The longest reason the server keeps in its privacy log. */
export const CUSTOMER_PRIVACY_REASON_MAX = 500

/** `erase` clears the data, `retain` is kept by law, `unhandled` is an application model that has no hook yet. */
export const CustomerPrivacyActionSchema = z.enum(['erase', 'retain', 'unhandled'])

export const CustomerPrivacyItemSchema = z.object({
  key: z.string().min(1),
  owner: z.string(),
  action: CustomerPrivacyActionSchema,
  count: z.number().int().nonnegative(),
  // False when the caller cannot reach every record of this kind.
  complete: z.boolean(),
}).strict()

/** One thing that stops the erase; `reason` is `application_has_no_hook`, `session_does_not_cover_every_company` or `caller_cannot_reach_all_records`. */
export const CustomerPrivacyIncompleteSchema = z.object({
  key: z.string().min(1),
  owner: z.string(),
  reason: z.string().min(1),
}).strict()

export const CustomerErasePreviewSchema = z.object({
  customer: z.object({ id: z.number().int().positive(), erased: z.boolean() }).strict(),
  items: z.array(CustomerPrivacyItemSchema),
  incomplete: z.array(CustomerPrivacyIncompleteSchema),
  empty_models: z.array(z.string()),
  not_covered: z.array(z.string()),
  reach: z.object({ shared: z.boolean(), covers_all: z.boolean() }).strict(),
  // One-time token the erase needs; valid `expires_in` seconds.
  token: z.string().min(1),
  expires_in: z.number().int().positive(),
}).strict()

export const CustomerEraseSchema = z.object({
  token: z.string().min(1),
  // The customer's name, compared exactly by the server.
  confirmation: z.string().min(1),
  reason: z.string().min(1).max(CUSTOMER_PRIVACY_REASON_MAX),
}).strict()

/** `erased` is false for a no-op on a customer that was already erased. */
export const CustomerEraseResultSchema = z.object({
  customer_id: z.number().int().positive(),
  erased: z.boolean(),
  request_id: z.number().int().positive().nullable(),
  items: z.array(z.object({ key: z.string().min(1), count: z.number().int().nonnegative() }).strict()),
}).strict()

export const CustomerPrivacyExportSchema = z.object({
  reason: z.string().min(1).max(CUSTOMER_PRIVACY_REASON_MAX),
}).strict()

/** `details` of the 409 `erase_incomplete`: what keeps the erase from running. */
export const CustomerEraseIncompleteDetailsSchema = z.object({
  incomplete: z.array(CustomerPrivacyIncompleteSchema).min(1),
}).strict()

export type CustomerPrivacyAction = z.infer<typeof CustomerPrivacyActionSchema>
export type CustomerPrivacyItem = z.infer<typeof CustomerPrivacyItemSchema>
export type CustomerPrivacyIncomplete = z.infer<typeof CustomerPrivacyIncompleteSchema>
export type CustomerErasePreview = z.infer<typeof CustomerErasePreviewSchema>
export type CustomerErase = z.infer<typeof CustomerEraseSchema>
export type CustomerEraseResult = z.infer<typeof CustomerEraseResultSchema>
export type CustomerPrivacyExport = z.infer<typeof CustomerPrivacyExportSchema>
export type CustomerEraseIncompleteDetails = z.infer<typeof CustomerEraseIncompleteDetailsSchema>
