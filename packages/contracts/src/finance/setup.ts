import { z } from 'zod'

const id = z.number().int().positive()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const count = z.number().int().nonnegative()
const ref = z.object({ id, name: z.string() }).strict()

export const FinanceSetupCompanyFieldSchema = z.enum([
  'vat', 'company_registry', 'street', 'city', 'state', 'country',
])
export const FinanceSetupBlockerSchema = z.enum([
  'vat_15_tax_missing', 'company_vat_missing', 'company_registry_missing',
  'company_address_incomplete', 'zatca_not_onboarded',
])

export const FinanceZatcaJournalStateSchema = z.enum(['not_started', 'compliance_checked', 'onboarded'])

/** Status only: no key material, CSR, CSID or secret is part of this shape. */
export const FinanceZatcaJournalSchema = z.object({
  journal: ref,
  onboarded: z.boolean(),
  state: FinanceZatcaJournalStateSchema,
}).strict()

export const FinanceZatcaReadinessSchema = z.object({
  api_mode: z.enum(['sandbox', 'preprod', 'prod']),
  private_key_present: z.boolean(),
  journals: z.array(FinanceZatcaJournalSchema),
  onboarded: z.boolean(),
}).strict()

export const FinanceSetupSchema = z.object({
  chart: z.object({
    loaded: z.boolean(),
    template: z.string().nullable(),
    accounts_count: count,
  }).strict(),
  company: z.object({
    name: z.string(),
    vat: z.string(),
    company_registry: z.string(),
    street: z.string(),
    city: z.string(),
    state: ref.nullable(),
    country: ref.nullable(),
    currency: z.string().min(1),
    missing_fields: z.array(FinanceSetupCompanyFieldSchema),
  }).strict(),
  fiscal: z.object({
    fiscalyear_last_day: z.number().int().min(1).max(31),
    fiscalyear_last_month: z.number().int().min(1).max(12),
    fiscalyear_lock_date: day.nullable(),
    tax_lock_date: day.nullable(),
    sale_lock_date: day.nullable(),
    purchase_lock_date: day.nullable(),
    hard_lock_date: day.nullable(),
    /** The account internal transfers pass through; the Saudi chart sets "Liquidity Transfer". */
    transfer_account: ref.nullable(),
  }).strict(),
  journals: z.object({ sale: count, purchase: count, bank: count, cash: count }).strict(),
  taxes: z.object({ sale_count: count, purchase_count: count, vat_15_present: z.boolean() }).strict(),
  zatca: FinanceZatcaReadinessSchema,
  ready: z.boolean(),
  blockers: z.array(FinanceSetupBlockerSchema),
}).strict()

/** PATCH /finance/setup/fiscal: the hard lock date is irreversible and never written here. */
export const FinanceSetupFiscalInputSchema = z.object({
  fiscalyear_last_day: z.number().int().min(1).max(31),
  fiscalyear_last_month: z.number().int().min(1).max(12),
  fiscalyear_lock_date: day.nullable(),
  tax_lock_date: day.nullable(),
  sale_lock_date: day.nullable(),
  purchase_lock_date: day.nullable(),
  transfer_account_id: z.number().int().positive(),
}).partial().strict()

export type FinanceSetupBlocker = z.infer<typeof FinanceSetupBlockerSchema>
export type FinanceZatcaJournal = z.infer<typeof FinanceZatcaJournalSchema>
export type FinanceZatcaReadiness = z.infer<typeof FinanceZatcaReadinessSchema>
export type FinanceSetup = z.infer<typeof FinanceSetupSchema>
export type FinanceSetupFiscalInput = z.infer<typeof FinanceSetupFiscalInputSchema>
