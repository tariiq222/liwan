import { aiBillingSettingsSchema, type AiBillingSettings } from '@liwan/commercial-contracts'
import { minorToInput, parseVendorMoneyInput } from './vendorCommercial'

/** AI billing amounts are riyals: the settings carry them as SAR minor units. */
const EXPONENT = 2
export const AI_BILLING_FIELDS = ['topup_amounts_minor', 'topup_minimum_minor', 'usd_rate', 'trial_allowance_minor', 'monthly_allowance_minor'] as const
export type AiBillingField = typeof AI_BILLING_FIELDS[number]

/** What the form edits: every value as the text the operator types. */
export interface AiBillingDraft { topup_amounts: string, topup_minimum: string, usd_rate: string, trial_allowance: string, monthly_allowance: string }

/**
 * The amounts of the list are separated by an Arabic comma or a semicolon, never by a Latin comma: a Latin comma inside an
 * amount is its thousands mark (1,250 is one amount), so "25, 50" is refused as ambiguous instead of being split.
 */
const AMOUNT_SEPARATOR = '، '
const AMOUNT_SEPARATORS = /[،;؛]/

export const draftFromAiBilling = (settings: AiBillingSettings): AiBillingDraft => ({
  topup_amounts: settings.topup_amounts_minor.map(minor => minorToInput(minor, EXPONENT)).join(AMOUNT_SEPARATOR),
  topup_minimum: minorToInput(settings.topup_minimum_minor, EXPONENT),
  usd_rate: settings.usd_rate,
  trial_allowance: minorToInput(settings.trial_allowance_minor, EXPONENT),
  monthly_allowance: minorToInput(settings.monthly_allowance_minor, EXPONENT),
})

/** The amounts of a list typed with Arabic commas or semicolons between them; null when one is not an amount (a Latin comma inside one is refused by the money parser unless it is a thousands mark). */
function parseAmounts(text: string): number[] | null {
  const parts = text.split(AMOUNT_SEPARATORS).filter(part => part.trim() !== '')
  const amounts = parts.map(part => parseVendorMoneyInput(part, EXPONENT))
  return parts.length > 0 && amounts.every((minor): minor is number => minor !== null) ? amounts : null
}

/** The settings the draft stands for, or the field that is wrong: the contract judges the merged result (ascending amounts, minimum, rate). */
export function aiBillingFromDraft(draft: AiBillingDraft): { ok: true, settings: AiBillingSettings } | { ok: false, field: AiBillingField } {
  const amounts = parseAmounts(draft.topup_amounts)
  if (!amounts) return { ok: false, field: 'topup_amounts_minor' }
  const minimum = parseVendorMoneyInput(draft.topup_minimum, EXPONENT)
  const trial = parseVendorMoneyInput(draft.trial_allowance, EXPONENT)
  const monthly = parseVendorMoneyInput(draft.monthly_allowance, EXPONENT)
  const parsed = aiBillingSettingsSchema.safeParse({ topup_amounts_minor: amounts, topup_minimum_minor: minimum, usd_rate: draft.usd_rate.trim(), trial_allowance_minor: trial, monthly_allowance_minor: monthly })
  if (parsed.success) return { ok: true, settings: parsed.data }
  const field = parsed.error.issues[0]?.path[0]
  return { ok: false, field: AI_BILLING_FIELDS.find(name => name === field) ?? 'topup_amounts_minor' }
}
