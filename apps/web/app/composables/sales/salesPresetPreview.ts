import type { SalesSettings, SalesSettingsPatch, SalesSettingsPreset } from '@liwan/contracts'

type PresetKey = keyof SalesSettingsPreset['values']

/** One setting a preset would change: what it holds now and what the preset sets. */
export interface SalesPresetChange { key: PresetKey; from: SalesSettings[PresetKey]; to: NonNullable<SalesSettingsPreset['values'][PresetKey]> }

/** The settings a preset would change, in the order of its values; a value the settings already hold is left out. */
export function salesPresetChanges(preset: SalesSettingsPreset, settings: SalesSettings): SalesPresetChange[] {
  return (Object.keys(preset.values) as PresetKey[]).flatMap((key) => {
    const to = preset.values[key]
    return to === undefined || settings[key] === to ? [] : [{ key, from: settings[key], to } as SalesPresetChange]
  })
}

/** The settings write that applies the preset: only the values that change, with the revision the page read them at. */
export function salesPresetPatch(preset: SalesSettingsPreset, settings: SalesSettings): SalesSettingsPatch {
  const values = Object.fromEntries(salesPresetChanges(preset, settings).map(({ key, to }) => [key, to]))
  return { ...values, revision: settings.revision }
}

/** The locale key that names each setting, reused from the card that edits it. */
export const SALES_PRESET_LABEL_KEYS: Record<PresetKey, string> = {
  visibility: 'sales.settings.visibility.title',
  validity_days: 'sales.settings.quotations.validityDays',
  discount_limit_percent: 'sales.settings.quotations.discountLimit',
  customer_answer: 'sales.settings.quotations.customerAnswer',
  acceptance_confirms: 'sales.settings.quotations.acceptanceConfirms',
  answered_resend: 'sales.settings.quotations.answeredResend',
  signature_methods: 'sales.settings.quotations.signatureMethods',
  payment_to_confirm: 'sales.settings.payment.mode',
  prepayment_percent: 'sales.settings.payment.shareLabel',
  opportunity_win: 'sales.settings.opportunity.win',
  opportunity_win_amount: 'sales.settings.opportunity.amount',
  invoice_down_payment: 'sales.settings.invoicing.downPayment',
  invoice_actor: 'sales.settings.invoicing.actor',
}

/** The locale namespace of the options of each choice setting; its keys are the option values. */
const OPTION_NAMESPACES: Partial<Record<PresetKey, string>> = {
  visibility: 'sales.settings.visibility',
  customer_answer: 'sales.settings.quotations.answer',
  answered_resend: 'sales.settings.quotations.resend',
  signature_methods: 'sales.settings.quotations.signature',
  payment_to_confirm: 'sales.settings.payment',
  opportunity_win: 'sales.settings.opportunity',
  opportunity_win_amount: 'sales.settings.opportunity',
  invoice_down_payment: 'sales.settings.invoicing',
  invoice_actor: 'sales.settings.invoicing',
}

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string

/** A setting's value in words: a choice by its option label, a number with its unit, a switch as yes or no. */
export function salesPresetValueLabel(key: PresetKey, value: SalesSettings[PresetKey], t: Translate): string {
  if (typeof value === 'boolean') return t(value ? 'sales.settings.presets.yes' : 'sales.settings.presets.no')
  if (key === 'validity_days') return value === 0 ? t('sales.settings.presets.noValidity') : t('sales.templates.days', { count: value }, Number(value))
  if (key === 'discount_limit_percent') return value === 0 ? t('sales.settings.presets.noLimit') : `${value}%`
  if (key === 'prepayment_percent') return `${value}%`
  return t(`${OPTION_NAMESPACES[key]}.${value}`)
}
