import { aiBillingSettingsSchema, MAX_MINOR, type AiBillingSettings } from '@liwan/commercial-contracts'
import { minorToInput, parseVendorMoneyInput } from './vendorCommercial'

/** AI billing amounts are riyals: the settings carry them as SAR minor units. */
const EXPONENT = 2
export const AI_BILLING_FIELDS = ['topup_amounts_minor', 'topup_minimum_minor', 'usd_rate', 'trial_allowance_minor', 'monthly_allowance_minor'] as const
export type AiBillingField = typeof AI_BILLING_FIELDS[number]

/** What the form edits: every value as the text the operator types; the top-up amounts are one text per row. */
export interface AiBillingDraft { topup_amounts: string[], topup_minimum: string, usd_rate: string, trial_allowance: string, monthly_allowance: string }

export const draftFromAiBilling = (settings: AiBillingSettings): AiBillingDraft => ({
  topup_amounts: settings.topup_amounts_minor.map(minor => minorToInput(minor, EXPONENT)),
  topup_minimum: minorToInput(settings.topup_minimum_minor, EXPONENT),
  usd_rate: settings.usd_rate,
  trial_allowance: minorToInput(settings.trial_allowance_minor, EXPONENT),
  monthly_allowance: minorToInput(settings.monthly_allowance_minor, EXPONENT),
})

/** Which top-up rows are not an amount the contract accepts (blank, text, too many decimals, zero, above the maximum): each row is judged alone, so the form can name it. */
export const topupRowErrors = (rows: string[]): boolean[] => rows.map((row) => {
  const minor = parseVendorMoneyInput(row, EXPONENT)
  return minor === null || minor < 1 || minor > MAX_MINOR
})

function parseDraft(draft: AiBillingDraft) {
  return aiBillingSettingsSchema.safeParse({
    topup_amounts_minor: draft.topup_amounts.map(row => parseVendorMoneyInput(row, EXPONENT)),
    topup_minimum_minor: parseVendorMoneyInput(draft.topup_minimum, EXPONENT),
    usd_rate: draft.usd_rate.trim(),
    trial_allowance_minor: parseVendorMoneyInput(draft.trial_allowance, EXPONENT),
    monthly_allowance_minor: parseVendorMoneyInput(draft.monthly_allowance, EXPONENT),
  })
}

const fieldOf = (path: PropertyKey | undefined): AiBillingField => AI_BILLING_FIELDS.find(name => name === path) ?? 'topup_amounts_minor'

/** The settings the draft stands for, or the field that is wrong: the contract judges the merged result (ascending amounts, minimum, rate). */
export function aiBillingFromDraft(draft: AiBillingDraft): { ok: true, settings: AiBillingSettings } | { ok: false, field: AiBillingField } {
  const parsed = parseDraft(draft)
  return parsed.success ? { ok: true, settings: parsed.data } : { ok: false, field: fieldOf(parsed.error.issues[0]?.path[0]) }
}

/** Every field the contract refuses, in form order, so each shows its own message and the summary lists them all. */
export function aiBillingInvalidFields(draft: AiBillingDraft): AiBillingField[] {
  const parsed = parseDraft(draft)
  if (parsed.success) return []
  const wrong = new Set(parsed.error.issues.map(issue => fieldOf(issue.path[0])))
  return AI_BILLING_FIELDS.filter(name => wrong.has(name))
}
