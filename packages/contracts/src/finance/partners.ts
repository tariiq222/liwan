import { z } from 'zod'
import { FinanceRefSchema, id, list, PATCH_MESSAGE, requirePatchField, text } from './shared'

export const FinancePartnerSchema = z.object({
  id,
  name: z.string(),
  vat: z.string(),
  company_registry: z.string(),
  street: z.string(),
  city: z.string(),
  state: FinanceRefSchema.nullable(),
  country: FinanceRefSchema.nullable(),
  is_company: z.boolean(),
  customer: z.boolean(),
  vendor: z.boolean(),
  active: z.boolean(),
}).strict()

export const FinancePartnerListSchema = list(FinancePartnerSchema)

export const FinancePartnerCreateSchema = z.object({
  name: text.trim().min(1),
  vat: text.optional(),
  company_registry: text.optional(),
  street: text.optional(),
  city: text.optional(),
  state_id: id.nullable().optional(),
  country_id: id.nullable().optional(),
  is_company: z.boolean().optional(),
  customer: z.boolean().optional(),
  vendor: z.boolean().optional(),
}).strict()

export const FinancePartnerPatchSchema = FinancePartnerCreateSchema.partial().strict()
  .refine(requirePatchField, PATCH_MESSAGE)

export type FinancePartner = z.infer<typeof FinancePartnerSchema>
export type FinancePartnerList = z.infer<typeof FinancePartnerListSchema>
export type FinancePartnerCreate = z.infer<typeof FinancePartnerCreateSchema>
export type FinancePartnerPatch = z.infer<typeof FinancePartnerPatchSchema>

/** A bank account of a customer or vendor: the sanitized number (an IBAN for Saudi banks) and its bank. */
export const FinancePartnerBankSchema = z.object({
  id,
  acc_number: z.string(),
  holder_name: z.string(),
  bank_name: z.string(),
  bic: z.string(),
  active: z.boolean(),
}).strict()

export const FinancePartnerBankListSchema = list(FinancePartnerBankSchema)

export const FinancePartnerBankCreateSchema = z.object({
  acc_number: text.trim().min(1).max(34),
  holder_name: text.optional(),
  bank_name: text.optional(),
  bic: text.optional(),
}).strict()

export const FinancePartnerBankPatchSchema = FinancePartnerBankCreateSchema.partial().strict()
  .refine(requirePatchField, PATCH_MESSAGE)

export type FinancePartnerBank = z.infer<typeof FinancePartnerBankSchema>
export type FinancePartnerBankList = z.infer<typeof FinancePartnerBankListSchema>
export type FinancePartnerBankCreate = z.infer<typeof FinancePartnerBankCreateSchema>
export type FinancePartnerBankPatch = z.infer<typeof FinancePartnerBankPatchSchema>
