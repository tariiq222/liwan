import { z } from 'zod'

/**
 * The establishment's one tax choice (GET/PATCH /admin/company/tax). Stock `res.company.account_price_include` is
 * the stored fact; `price_mode` is the wire word, and `choice` folds "not registered" into `none`.
 */
export const CompanyTaxSchema = z.object({
  /** Whether the establishment is registered for VAT. */
  registered: z.boolean(),
  /** What a price typed on a product means: `included` (the customer pays it) or `added` (the tax is on top). */
  price_mode: z.enum(['included', 'added']),
  /** `none` while the establishment is not registered; otherwise the price mode it keeps for a later registration. */
  choice: z.enum(['none', 'included', 'added']),
  /** Included or added cannot change once the establishment or any branch has a journal item. */
  locked: z.boolean(),
  /** VAT registration may still change while the price mode is locked. */
  can_change: z.boolean(),
  /** True in the root company's session: the choice is changed from there, and a branch gets 403 on PATCH. */
  is_root_session: z.boolean(),
}).strict()
export type CompanyTax = z.infer<typeof CompanyTaxSchema>

/** PATCH /admin/company/tax: both fields optional, at least one present; unknown keys are a 422. */
export const CompanyTaxPatchSchema = z.object({
  registered: z.boolean(),
  price_mode: z.enum(['included', 'added']),
}).partial().strict().refine(patch => Object.keys(patch).length > 0, { message: 'At least one field is required' })
export type CompanyTaxPatch = z.infer<typeof CompanyTaxPatchSchema>
