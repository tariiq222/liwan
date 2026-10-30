import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../composables/useApi'
import { eosProvisionErrorMessage, payrollErrorMessage, payrollFieldError, payrollWarningText } from '../payrollErrors'

// The real locale files the UI ships, so a code without a text fails instead of hiding behind the key itself:
// the payroll namespace, the shared `errors.saveUncertain` and `app.listSeparator`, and `errors.generic` from the @webvue/ui layer that
// Nuxt merges into the app's messages.
const read = (relative: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, relative), 'utf8'))
const arPayroll = read('../../../i18n/locales/ar/hr-payroll.json').hrPayroll
const enPayroll = read('../../../i18n/locales/en/hr-payroll.json').hrPayroll
const sharedAr = {
  generic: read('../../../../../packages/ui/i18n/locales/ar/ui.json').errors.generic,
  saveUncertain: read('../../../i18n/locales/ar/common.json').errors.saveUncertain,
  listSeparator: read('../../../i18n/locales/ar/common.json').app.listSeparator,
}

// The refusal codes of the payroll routes that have their own text, and the ones that list the employees they name
// (kept in step with OWN_TEXT/NAMING in payrollErrors.ts).
const OWN_CODES = [
  'duplicate', 'transition_forbidden', 'structure_missing', 'contract_missing', 'gosi_rate_missing', 'payroll_structure_mismatch',
  'compensation_missing', 'settlement_missing', 'custody_open', 'settlement_changed', 'annual_leave_type_missing', 'departure_missing', 'eos_case_missing',
  'period_locked', 'missing_cost_center', 'settings_incomplete', 'wps_totals_mismatch', 'run_empty', 'nationality_missing',
  'gosi_registration_missing', 'provision_after_run', 'profile_in_use', 'profile_unavailable', 'currency_unsupported',
]
const NAMING_CODES = ['negative_net', 'missing_iban', 'run_stale']

function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''))
}

// The real translator: an unknown key throws, so a refusal code without a locale text cannot pass unnoticed.
function lookup(key: string): unknown {
  if (key.startsWith('hrPayroll.errors.')) return arPayroll.errors[key.slice('hrPayroll.errors.'.length)]
  if (key.startsWith('hrPayroll.warnings.')) return arPayroll.warnings[key.slice('hrPayroll.warnings.'.length)]
  return { 'errors.generic': sharedAr.generic, 'errors.saveUncertain': sharedAr.saveUncertain, 'app.listSeparator': sharedAr.listSeparator }[key]
}
function t(key: string, params?: Record<string, unknown>): string {
  const template = lookup(key)
  if (typeof template !== 'string') throw new Error(`missing locale key: ${key}`)
  return interpolate(template, params)
}
const te = (key: string) => typeof lookup(key) === 'string'

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

  it('sends an editable run to the compensation, but never an approved run whose snapshot is fixed', () => {
    const error = new ApiError(422, 'missing_iban', 'raw', 'iban', { employee_ids: [4] })
    for (const state of ['draft', 'computed'] as const) {
      expect(payrollErrorMessage(error, t, names, state)).toBe(interpolate(arPayroll.errors.missing_iban, { names: 'سارة', count: 1 }))
    }
    for (const state of ['approved', 'posted', 'paid'] as const) {
      const text = payrollErrorMessage(error, t, names, state)
      expect(text).toBe('تعذّر إنشاء الملف لأن لقطة بيانات الدفع عند اعتماد هذا المسيّر ناقصة لـسارة. تعديل الآيبان في التعويضات الآن لن يغيّر هذا المسيّر. تواصل مع مسؤول الرواتب أو الدعم لمعالجة موثّقة.')
      expect(text).not.toContain('قبل الاعتماد')
    }
    const unnamed = new ApiError(422, 'missing_iban', 'raw', 'iban', { employee_ids: [8, 9] })
    expect(payrollErrorMessage(unnamed, t, names, 'approved')).toBe(interpolate(arPayroll.errors.missing_iban_snapshot_count, { names: '', count: 2 }))
    expect(enPayroll.errors.missing_iban_snapshot).toContain('will not change this run')
    expect(enPayroll.warnings.missing_iban_snapshot).toContain('will not change this run')
  })

  it('keeps every other naming refusal the same on an approved run', () => {
    const error = new ApiError(422, 'negative_net', 'raw', undefined, { employee_ids: [3] })
    expect(payrollErrorMessage(error, t, names, 'approved')).toBe(interpolate(arPayroll.errors.negative_net, { names: 'ليلى', count: 1 }))
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

describe('payrollWarningText', () => {
  const warning = { code: 'missing_iban', employee: { id: 4, name: 'سارة' } }

  it('asks for the IBAN in the compensation before the approval', () => {
    for (const state of ['draft', 'computed'] as const) {
      expect(payrollWarningText(warning, state, t, te)).toBe(interpolate(arPayroll.warnings.missing_iban, { name: 'سارة' }))
    }
    expect(arPayroll.warnings.missing_iban).toContain('أكمل الآيبان في التعويضات قبل الاعتماد')
  })

  it('says the approved snapshot is incomplete and the compensation will not change the run', () => {
    for (const state of ['approved', 'posted', 'paid'] as const) {
      const text = payrollWarningText(warning, state, t, te)
      expect(text).toBe(interpolate(arPayroll.warnings.missing_iban_snapshot, { name: 'سارة' }))
      expect(text).toContain('لن يغيّر هذا المسيّر')
    }
  })

  it('keeps the other warnings and shows an unknown code raw', () => {
    const missing = { code: 'compensation_missing', employee: { id: 3, name: 'ليلى' } }
    expect(payrollWarningText(missing, 'approved', t, te)).toBe(interpolate(arPayroll.warnings.compensation_missing, { name: 'ليلى' }))
    expect(payrollWarningText({ code: 'new_code', employee: { id: 3, name: 'ليلى' } }, 'computed', t, te)).toBe('new_code: ليلى')
  })

  it('warns of an employee with compensation but no running contract', () => {
    const warning = { code: 'contract_missing', employee: { id: 5, name: 'سارة' } }
    expect(payrollWarningText(warning, 'computed', t, te)).toBe(interpolate(arPayroll.warnings.contract_missing, { name: 'سارة' }))
    expect(arPayroll.warnings.contract_missing).toContain('تاريخ بداية عقده')
    expect(enPayroll.warnings.contract_missing).toContain('contract start date')
  })

  it('tells where to set the nationality when GOSI cannot be computed', () => {
    const error = new ApiError(422, 'nationality_missing', 'Payroll cannot compute GOSI: nationality_missing', 'employee_id')
    const text = payrollErrorMessage(error, t, new Map())
    expect(text).toBe(arPayroll.errors.nationality_missing)
    expect(text).not.toContain('nationality_missing')
    expect(text).toContain('تعديل الموظف')
  })

  it('has the same warning keys in ar and en', () => {
    expect(Object.keys(arPayroll.warnings).sort()).toEqual(Object.keys(enPayroll.warnings).sort())
  })
})
