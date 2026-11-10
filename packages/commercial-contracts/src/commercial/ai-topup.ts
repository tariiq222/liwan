import { z } from 'zod'
import { CommercialError } from './types.js'

/**
 * AI top-up (spec 2026-11-10-liwan-ai-plans-and-router-design, 5.1 to 5.4). A tenant buys AI balance with a one-time
 * payment; the control plane delivers three integers, in AI cost units (one unit is 0.00001 USD), with the
 * entitlement. They are derived keys like `users.limit`: no plan, bundle or terms revision may set them, and they
 * are not part of the entitlement digest, because they follow a ledger and vendor settings, not a revision.
 */
export const AI_BALANCE_GRANTED_KEY = 'ai.balance.granted'
export const AI_ALLOWANCE_TRIAL_KEY = 'ai.allowance.trial'
export const AI_ALLOWANCE_MONTHLY_KEY = 'ai.allowance.monthly'
export const AI_ENTITLEMENT_KEYS: readonly string[] = [AI_BALANCE_GRANTED_KEY, AI_ALLOWANCE_TRIAL_KEY, AI_ALLOWANCE_MONTHLY_KEY]
/** A delivered feature value never exceeds this (the tenant effect and the provisioning contract both refuse more). */
export const AI_UNITS_MAX = 1_000_000_000
/** Top-ups are priced in riyals; the cost unit is a hundred-thousandth of a US dollar. */
export const AI_TOPUP_CURRENCY = 'SAR'
export const AI_TOPUP_EXPONENT = 2
const AI_UNITS_PER_USD = 100_000n

const MAX_MINOR = 100_000_000
/** A decimal string so the rate is exact; no float ever touches money. */
export const usdRateSchema = z.string().regex(/^\d{1,4}(?:\.\d{1,6})?$/, 'invalid_usd_rate').refine(v => /[1-9]/.test(v), 'invalid_usd_rate')
const amountMinor = z.number().int().min(1).max(MAX_MINOR)
const allowanceMinor = z.number().int().min(0).max(MAX_MINOR)
const settingFields = {
  topup_amounts_minor: z.array(amountMinor).min(1).max(12),
  topup_minimum_minor: amountMinor,
  usd_rate: usdRateSchema,
  trial_allowance_minor: allowanceMinor,
  monthly_allowance_minor: allowanceMinor,
}

/** Vendor-wide AI billing settings (not plan fields: a renewal reuses the pinned revision). Amounts are SAR minor units. */
export const aiBillingSettingsSchema = z.strictObject(settingFields).superRefine((v, ctx) => {
  const sorted = v.topup_amounts_minor.every((a, i, all) => i === 0 || a > all[i - 1]!)
  if (!sorted) ctx.addIssue({ code: 'custom', path: ['topup_amounts_minor'], message: 'amounts must be unique and ascending' })
  if (v.topup_amounts_minor.some(a => a < v.topup_minimum_minor))
    ctx.addIssue({ code: 'custom', path: ['topup_minimum_minor'], message: 'every offered amount must reach the minimum' })
})
export type AiBillingSettings = z.infer<typeof aiBillingSettingsSchema>

/** Every field optional: an omitted one keeps its stored value. The merged result is validated as a whole. */
export const aiBillingSettingsInputSchema = z.strictObject({
  topup_amounts_minor: settingFields.topup_amounts_minor.optional(),
  topup_minimum_minor: settingFields.topup_minimum_minor.optional(),
  usd_rate: settingFields.usd_rate.optional(),
  trial_allowance_minor: settingFields.trial_allowance_minor.optional(),
  monthly_allowance_minor: settingFields.monthly_allowance_minor.optional(),
  reason: z.string().trim().min(3).max(1000),
})
export type AiBillingSettingsInput = z.infer<typeof aiBillingSettingsInputSchema>

/** What the customer purchase page reads, so it hard-codes no amount or rate. */
export const aiTopupCatalogSchema = z.strictObject({
  currency: z.literal(AI_TOPUP_CURRENCY), exponent: z.literal(AI_TOPUP_EXPONENT),
  amounts_minor: z.array(amountMinor), minimum_minor: amountMinor, usd_rate: usdRateSchema,
})
export type AiTopupCatalog = z.infer<typeof aiTopupCatalogSchema>

/**
 * SAR minor units to AI cost units: `round_down(minor / 100 / rate * 100000)`, exact (bigint, no float).
 * With the rate `n / 10^s` this is `floor(minor * 1000 * 10^s / n)`.
 */
export function sarMinorToAiUnits(minor: number, usdRate: string): number {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new CommercialError('invalid_quantity', 'ai_topup_minor')
  if (!usdRateSchema.safeParse(usdRate).success) throw new CommercialError('invalid', 'usd_rate')
  const [whole = '0', fraction = ''] = usdRate.split('.')
  const scale = 10n ** BigInt(fraction.length)
  const units = (BigInt(minor) * (AI_UNITS_PER_USD / 100n) * scale) / BigInt(`${whole}${fraction}`)
  if (units > BigInt(AI_UNITS_MAX)) throw new CommercialError('ai_balance_limit_exceeded', 'ai_topup_minor')
  return Number(units)
}

/** The three delivered keys. Throws when a total would not fit the delivered range. */
export function aiEntitlementFeatures(input: { granted_units: number; trial_units: number; monthly_units: number }): Record<string, number> {
  for (const v of [input.granted_units, input.trial_units, input.monthly_units])
    if (!Number.isSafeInteger(v) || v < 0 || v > AI_UNITS_MAX) throw new CommercialError('ai_balance_limit_exceeded', AI_BALANCE_GRANTED_KEY)
  return { [AI_BALANCE_GRANTED_KEY]: input.granted_units, [AI_ALLOWANCE_TRIAL_KEY]: input.trial_units, [AI_ALLOWANCE_MONTHLY_KEY]: input.monthly_units }
}
