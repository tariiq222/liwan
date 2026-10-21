import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../composables/useApi'
import { eosProvisionErrorMessage, payrollErrorMessage, payrollFieldError } from '../payrollErrors'

// The real locale files the UI ships, so a code without a text fails instead of hiding behind the key itself:
// the payroll namespace, the shared `errors.saveUncertain`, and `errors.generic` from the @webvue/ui layer that
// Nuxt merges into the app's messages.
const read = (relative: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, relative), 'utf8'))
const arPayroll = read('../../../i18n/locales/ar/hr-payroll.json').hrPayroll
const enPayroll = read('../../../i18n/locales/en/hr-payroll.json').hrPayroll
const sharedAr = {
  generic: read('../../../../../packages/ui/i18n/locales/ar/ui.json').errors.generic,
  saveUncertain: read('../../../i18n/locales/ar/common.json').errors.saveUncertain,
}

// The refusal codes of the payroll routes that have their own text, and the ones that list the employees they name
// (kept in step with OWN_TEXT/NAMING in payrollErrors.ts).
const OWN_CODES = [
  'duplicate', 'transition_forbidden', 'structure_missing', 'contract_missing', 'gosi_rate_missing', 'payroll_structure_mismatch',
  'compensation_missing', 'settlement_missing', 'settlement_changed', 'annual_leave_type_missing', 'departure_missing', 'eos_case_missing',
  'period_locked', 'missing_cost_center', 'settings_incomplete', 'wps_totals_mismatch', 'run_empty', 'nationality_missing',
  'gosi_registration_missing', 'provision_after_run',
]
const NAMING_CODES = ['negative_net', 'missing_iban', 'run_stale']

function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''))
}

// The real translator: an unknown key throws, so a refusal code without a locale text cannot pass unnoticed.
function t(key: string, params?: Record<string, unknown>): string {
  const template = key.startsWith('hrPayroll.errors.')
    ? arPayroll.errors[key.slice('hrPayroll.errors.'.length)]
    : { 'errors.generic': sharedAr.generic, 'errors.saveUncertain': sharedAr.saveUncertain }[key]
  if (typeof template !== 'string') throw new Error(`missing locale key: ${key}`)
  return interpolate(template, params)
}

const names = new Map([[3, 'ليلى'], [4, 'سارة']])

describe('payrollErrorMessage', () => {
  it.each(OWN_CODES)('shows the locale own text of %s', (code) => {
    expect(payrollErrorMessage(new ApiError(422, code, 'raw'), t, names)).toBe(arPayroll.errors[code])
  })

  it('has an ar and an en text for every refusal code the payroll pages explain', () => {
    expect(Object.keys(arPayroll.errors).sort()).toEqual(Object.keys(enPayroll.errors).sort())
    for (const code of [...OWN_CODES, ...NAMING_CODES]) {
      expect(arPayroll.errors[code], `ar hrPayroll.errors.${code}`).toBeTruthy()
      expect(enPayroll.errors[code], `en hrPayroll.errors.${code}`).toBeTruthy()
    }
  })

  it('lists the employees of a negative net by name and falls back to the count', () => {
    const listed = new ApiError(422, 'negative_net', 'raw', undefined, { employee_ids: [3, 9] })
    expect(payrollErrorMessage(listed, t, names)).toBe(interpolate(arPayroll.errors.negative_net, { names: 'ليلى', count: 2 }))
    const counted = new ApiError(422, 'negative_net', 'raw', undefined, { employee_ids: [9] })
    expect(payrollErrorMessage(counted, t, names)).toBe(interpolate(arPayroll.errors.negative_net_count, { names: '', count: 1 }))
  })

  it('lists the employees without an IBAN by name', () => {
    const error = new ApiError(422, 'missing_iban', 'raw', 'iban', { employee_ids: [4, 3] })
    expect(payrollErrorMessage(error, t, names)).toBe(interpolate(arPayroll.errors.missing_iban, { names: 'سارة، ليلى', count: 2 }))
  })

  it('falls back to the count-only text when no name is known', () => {
    const error = new ApiError(422, 'missing_iban', 'raw', 'iban', { employee_ids: [8, 9] })
    expect(payrollErrorMessage(error, t, names)).toBe(interpolate(arPayroll.errors.missing_iban_count, { names: '', count: 2 }))
  })

  it('names the employees of a stale run and falls back to the count', () => {
    const named = new ApiError(422, 'run_stale', 'raw', 'employee_id', { employee_ids: [3] })
    expect(payrollErrorMessage(named, t, names)).toBe(interpolate(arPayroll.errors.run_stale, { names: 'ليلى', count: 1 }))
    const counted = new ApiError(422, 'run_stale', 'raw', 'employee_id', { employee_ids: [9] })
    expect(payrollErrorMessage(counted, t, names)).toBe(interpolate(arPayroll.errors.run_stale_count, { names: '', count: 1 }))
  })

  it('explains an empty run with its own text', () => {
    const error = new ApiError(422, 'run_empty', 'raw', 'employee_id')
    expect(payrollErrorMessage(error, t, names)).toBe(arPayroll.errors.run_empty)
  })

  it('says a departure before the service start is refused', () => {
    const error = new ApiError(422, 'invalid', 'raw', 'date', { start_date: '2023-12-01' })
    expect(payrollErrorMessage(error, t, names)).toBe(arPayroll.errors.departureBeforeStart)
  })

  it('says a payment date before the payroll entry is refused, apart from the departure date', () => {
    expect(payrollErrorMessage(new ApiError(422, 'invalid', 'raw', 'date'), t, names)).toBe(arPayroll.errors.paymentBeforeEntry)
  })

  it('gives the provision refusals their own texts', () => {
    expect(eosProvisionErrorMessage(new ApiError(422, 'duplicate', 'raw', 'month'), t)).toBe(arPayroll.errors.eos_provision_duplicate)
    expect(eosProvisionErrorMessage(new ApiError(422, 'invalid', 'raw', 'month'), t)).toBe(arPayroll.errors.eos_provision_empty)
    expect(eosProvisionErrorMessage(new ApiError(422, 'invalid', 'raw', 'date'), t)).toBe(arPayroll.errors.paymentBeforeEntry)
    expect(eosProvisionErrorMessage(new ApiError(403, 'transition_forbidden', 'raw', 'month'), t)).toBe(arPayroll.errors.transition_forbidden)
  })

  it('says a run that can no longer be edited is locked', () => {
    const error = new ApiError(403, 'transition_forbidden', 'raw', undefined, { reason: 'not_editable' })
    expect(payrollErrorMessage(error, t, names)).toBe(arPayroll.errors.notEditable)
  })

  it('shows the generic text of an unknown refusal, never the server English message', () => {
    expect(payrollErrorMessage(new ApiError(422, 'invalid', 'bonus_amount must be zero or more', 'bonus_amount'), t, names)).toBe(sharedAr.generic)
    expect(payrollErrorMessage(new ApiError(500, 'odoo_error', 'Something went wrong'), t, names)).toBe(sharedAr.generic)
    expect(payrollErrorMessage(new Error('boom'), t, names)).toBe(sharedAr.generic)
  })

  it('gives the GOSI rate refusals their own texts', () => {
    expect(payrollErrorMessage(new ApiError(422, 'invalid', 'raw', 'date_from'), t, names)).toBe(arPayroll.errors.rateDuplicate)
    expect(payrollErrorMessage(new ApiError(422, 'invalid', 'raw', 'wage_max'), t, names)).toBe(arPayroll.errors.wageRange)
  })

  it('says a manager cannot approve their own payslip, apart from the run state refusal', () => {
    const own = new ApiError(403, 'transition_forbidden', 'raw', 'employee_id', { employee_ids: [3] })
    expect(payrollErrorMessage(own, t, names)).toBe(arPayroll.errors.ownRecordForbidden)
    expect(payrollErrorMessage(new ApiError(403, 'transition_forbidden', 'raw', 'state'), t, names)).toBe(arPayroll.errors.transition_forbidden)
  })

  it('says an unconfirmed save is uncertain, whatever its code', () => {
    expect(payrollErrorMessage(new ApiError(0, 'http_error', 'offline'), t, names)).toBe(sharedAr.saveUncertain)
  })
})

describe('payrollFieldError', () => {
  it('names the field the server refused, in the page text rather than the server English', () => {
    const error = new ApiError(422, 'invalid', 'wage_max must not be below wage_min', 'wage_max')
    expect(payrollFieldError(error, t, 'wage_max')).toBe(arPayroll.errors.wageRange)
    expect(payrollFieldError(error, t, 'wage_min')).toBeUndefined()
  })

  it('has nothing to say about a refusal that named no field, or no API error at all', () => {
    expect(payrollFieldError(new Error('boom'), t, 'iban')).toBeUndefined()
    expect(payrollFieldError(new ApiError(403, 'forbidden', 'raw'), t, 'iban')).toBeUndefined()
  })

  it('shows the generic text for a field refusal it has no text for', () => {
    const error = new ApiError(422, 'invalid', 'bonus_amount must be zero or more', 'bonus_amount')
    expect(payrollFieldError(error, t, 'bonus_amount')).toBe(sharedAr.generic)
  })
})
