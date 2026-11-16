import { describe, expect, it } from 'vitest'
import type { SalesSettings, SalesSettingsPreset } from '@liwan/contracts'
import { SALES_PRESET_LABEL_KEYS, salesPresetChanges, salesPresetPatch, salesPresetValueLabel } from '../salesPresetPreview'

const SETTINGS: SalesSettings = {
  visibility: 'own', validity_days: 30, discount_limit_percent: 0, default_terms: 'Net 30', customer_answer: 'accept', acceptance_confirms: false,
  answered_resend: 'allow', signature_methods: 'draw_or_type', revision: 4, can_manage: true,
}
const PRESET: SalesSettingsPreset = {
  key: 'contracting', matches: false,
  values: { visibility: 'all', validity_days: 30, discount_limit_percent: 3, customer_answer: 'accept_and_sign', acceptance_confirms: false, answered_resend: 'refuse', signature_methods: 'draw' },
}
const t = (key: string, named?: Record<string, unknown>) => named ? `${key}:${JSON.stringify(named)}` : key

describe('sales preset preview', () => {
  it('lists only the settings a preset would change, in the preset order', () => {
    expect(salesPresetChanges(PRESET, SETTINGS).map(({ key, from, to }) => [key, from, to])).toEqual([
      ['visibility', 'own', 'all'], ['discount_limit_percent', 0, 3], ['customer_answer', 'accept', 'accept_and_sign'],
      ['answered_resend', 'allow', 'refuse'], ['signature_methods', 'draw_or_type', 'draw'],
    ])
  })

  it('skips a setting the tenant does not carry and a preset that already matches', () => {
    const withBridge = { ...PRESET, values: { ...PRESET.values, invoice_actor: 'any_biller' as const } }
    expect(salesPresetChanges(withBridge, SETTINGS).map(change => change.key)).toContain('invoice_actor')
    expect(salesPresetChanges(withBridge, { ...SETTINGS, invoice_actor: 'any_biller' }).map(change => change.key)).not.toContain('invoice_actor')
    expect(salesPresetChanges(PRESET, { ...SETTINGS, ...PRESET.values })).toEqual([])
  })

  it('writes only the changed values with the revision the page read, never the default terms', () => {
    const patch = salesPresetPatch(PRESET, SETTINGS)
    expect(patch).toEqual({ visibility: 'all', discount_limit_percent: 3, customer_answer: 'accept_and_sign', answered_resend: 'refuse', signature_methods: 'draw', revision: 4 })
    expect(patch).not.toHaveProperty('default_terms')
  })

  it('names every setting a preset can hold', () => {
    const keys = new Set(Object.keys(SALES_PRESET_LABEL_KEYS))
    for (const key of Object.keys(PRESET.values)) expect(keys.has(key)).toBe(true)
    expect(keys.size).toBe(13)
  })

  it('puts a value in words: an option label, a unit, a limit and a switch', () => {
    expect(salesPresetValueLabel('visibility', 'all', t)).toBe('sales.settings.visibility.all')
    expect(salesPresetValueLabel('customer_answer', 'accept_and_sign', t)).toBe('sales.settings.quotations.answer.accept_and_sign')
    expect(salesPresetValueLabel('answered_resend', 'refuse', t)).toBe('sales.settings.quotations.resend.refuse')
    expect(salesPresetValueLabel('payment_to_confirm', 'full', t)).toBe('sales.settings.payment.full')
    expect(salesPresetValueLabel('opportunity_win_amount', 'untaxed', t)).toBe('sales.settings.opportunity.untaxed')
    expect(salesPresetValueLabel('invoice_actor', 'any_biller', t)).toBe('sales.settings.invoicing.any_biller')
    expect(salesPresetValueLabel('discount_limit_percent', 0, t)).toBe('sales.settings.presets.noLimit')
    expect(salesPresetValueLabel('discount_limit_percent', 5, t)).toBe('5%')
    expect(salesPresetValueLabel('prepayment_percent', 50, t)).toBe('50%')
    expect(salesPresetValueLabel('validity_days', 0, t)).toBe('sales.settings.presets.noValidity')
    expect(salesPresetValueLabel('validity_days', 7, t)).toBe('sales.templates.days:{"count":7}')
    expect(salesPresetValueLabel('acceptance_confirms', true, t)).toBe('sales.settings.presets.yes')
    expect(salesPresetValueLabel('acceptance_confirms', false, t)).toBe('sales.settings.presets.no')
  })
})
