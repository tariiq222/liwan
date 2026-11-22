import { describe, expect, it } from 'vitest'
import { aiBillingFromDraft, draftFromAiBilling } from '../vendorAiBilling'

const settings = { topup_amounts_minor: [2500, 5000, 10000], topup_minimum_minor: 2500, usd_rate: '3.75', trial_allowance_minor: 500, monthly_allowance_minor: 1000 }

describe('AI billing settings draft', () => {
  it('shows the stored settings as riyal text and gives the same settings back', () => {
    const draft = draftFromAiBilling(settings)
    expect(draft).toEqual({ topup_amounts: '25.00، 50.00، 100.00', topup_minimum: '25.00', usd_rate: '3.75', trial_allowance: '5.00', monthly_allowance: '10.00' })
    expect(aiBillingFromDraft(draft)).toEqual({ ok: true, settings })
  })
  it('reads amounts separated by Arabic commas or semicolons, in Arabic-Indic digits too', () => {
    const draft = { ...draftFromAiBilling(settings), topup_amounts: '٢٥، 50;100؛200.5' }
    expect(aiBillingFromDraft(draft)).toMatchObject({ ok: true, settings: { topup_amounts_minor: [2500, 5000, 10000, 20050] } })
  })
  it('keeps a grouped number whole: a comma is a thousands mark, never a separator', () => {
    const draft = draftFromAiBilling(settings)
    expect(aiBillingFromDraft({ ...draft, topup_minimum: '25', topup_amounts: '1,250' })).toMatchObject({ ok: true, settings: { topup_amounts_minor: [125000] } })
    expect(aiBillingFromDraft({ ...draft, topup_minimum: '25', topup_amounts: '50، 1,250' })).toMatchObject({ ok: true, settings: { topup_amounts_minor: [5000, 125000] } })
    for (const ambiguous of ['25, 50, 100', '25,50', '1,250,50']) expect(aiBillingFromDraft({ ...draft, topup_amounts: ambiguous }), ambiguous).toEqual({ ok: false, field: 'topup_amounts_minor' })
  })
  it('writes a list back with the separator it reads', () => {
    const draft = draftFromAiBilling({ ...settings, topup_amounts_minor: [2500, 125000], topup_minimum_minor: 2500 })
    expect(aiBillingFromDraft(draft)).toMatchObject({ ok: true, settings: { topup_amounts_minor: [2500, 125000] } })
  })
  it('names the field that is wrong', () => {
    const draft = draftFromAiBilling(settings)
    expect(aiBillingFromDraft({ ...draft, topup_amounts: '' })).toEqual({ ok: false, field: 'topup_amounts_minor' })
    expect(aiBillingFromDraft({ ...draft, topup_amounts: '50، 25' })).toEqual({ ok: false, field: 'topup_amounts_minor' })
    expect(aiBillingFromDraft({ ...draft, topup_amounts: '25، x' })).toEqual({ ok: false, field: 'topup_amounts_minor' })
    expect(aiBillingFromDraft({ ...draft, topup_minimum: '30' })).toEqual({ ok: false, field: 'topup_minimum_minor' })
    expect(aiBillingFromDraft({ ...draft, topup_minimum: '' })).toEqual({ ok: false, field: 'topup_minimum_minor' })
    expect(aiBillingFromDraft({ ...draft, usd_rate: '3,75' })).toEqual({ ok: false, field: 'usd_rate' })
    expect(aiBillingFromDraft({ ...draft, usd_rate: '0' })).toEqual({ ok: false, field: 'usd_rate' })
    expect(aiBillingFromDraft({ ...draft, trial_allowance: '-1' })).toEqual({ ok: false, field: 'trial_allowance_minor' })
    expect(aiBillingFromDraft({ ...draft, monthly_allowance: '1.234' })).toEqual({ ok: false, field: 'monthly_allowance_minor' })
  })
  it('accepts a zero allowance', () => {
    expect(aiBillingFromDraft({ ...draftFromAiBilling(settings), trial_allowance: '0', monthly_allowance: '0' })).toMatchObject({ ok: true, settings: { trial_allowance_minor: 0, monthly_allowance_minor: 0 } })
  })
})
