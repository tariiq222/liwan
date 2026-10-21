import { describe, expect, it } from 'vitest'
import {
  HrCompensationSchema,
  HrBankProfileListSchema,
  HrBankProfileSchema,
  HrBankProfileWriteSchema,
  HrCompensationWriteSchema,
  HrGosiStatementSchema,
  HrGosiRateListSchema,
  HrGosiRateSchema,
  HrGosiRateWriteSchema,
  HrMyPayslipListSchema,
  HrPayrollCostCenterListSchema,
  HrPayrollCostCenterWriteSchema,
  HrPayrollFinanceSettingsPatchSchema,
  HrPayrollFinanceSettingsSchema,
  HrPayrollPaymentCreateSchema,
  HrPayrollPostingPreviewSchema,
  HrPayrollRunCreateSchema,
  HrPayrollRunListSchema,
  HrPayrollRunSchema,
  HrPayrollRunStateSchema,
  HrPayrollSettingsPatchSchema,
  HrPayrollSettingsSchema,
  HrPayslipInputsPatchSchema,
  HrPayslipRowListSchema,
  HrPayslipRowSchema,
  HrPayslipSchema,
} from '..'

const COMPENSATION = {
  employee: { id: 3, name: 'ليلى الحربي' },
  basic_wage: 8000,
  housing_allowance: 2000,
  transport_allowance: 500,
  other_allowance: 0,
  fixed_wage: 10500,
  iban: 'SA0380000000608010167519',
  bank: { id: 4, name: 'الراجحي' },
  gosi_number: '123456789',
  gosi_registration_date: '2024-01-01',
  nationality: { id: 186, name: 'السعودية', code: 'SA' },
}

const WRITE = {
  basic_wage: 8000,
  housing_allowance: 2000,
  transport_allowance: 500,
  other_allowance: 0,
  iban: 'SA0380000000608010167519',
  bank_id: 4,
  gosi_number: '123456789',
  gosi_registration_date: '2024-01-01',
}

describe('HrCompensationSchema', () => {
  it('accepts the compensation detail', () => {
    expect(HrCompensationSchema.parse(COMPENSATION)).toEqual(COMPENSATION)
    expect(HrCompensationSchema.parse({ ...COMPENSATION, iban: null, bank: null, gosi_number: null, gosi_registration_date: null, nationality: null })).toBeTruthy()
  })

  it('rejects an unknown key', () => {
    expect(HrCompensationSchema.safeParse({ ...COMPENSATION, salary: 1 }).success).toBe(false)
  })
})

describe('HrCompensationWriteSchema', () => {
  it('accepts a full write and nullable bank fields', () => {
    expect(HrCompensationWriteSchema.parse(WRITE)).toEqual(WRITE)
    expect(HrCompensationWriteSchema.safeParse({ ...WRITE, iban: null, bank_id: null, gosi_number: null, gosi_registration_date: null }).success).toBe(true)
  })

  it('rejects a non-Saudi IBAN', () => {
    expect(HrCompensationWriteSchema.safeParse({ ...WRITE, iban: 'GB29NWBK60161331926819' }).success).toBe(false)
    expect(HrCompensationWriteSchema.safeParse({ ...WRITE, iban: 'SA03 8000' }).success).toBe(false)
  })

  it('requires a positive basic wage and non-negative allowances', () => {
    expect(HrCompensationWriteSchema.safeParse({ ...WRITE, basic_wage: 0 }).success).toBe(false)
    expect(HrCompensationWriteSchema.safeParse({ ...WRITE, housing_allowance: -1 }).success).toBe(false)
  })

  it('rejects a missing or unknown key', () => {
    const { basic_wage: _omit, ...rest } = WRITE
    expect(HrCompensationWriteSchema.safeParse(rest).success).toBe(false)
    expect(HrCompensationWriteSchema.safeParse({ ...WRITE, fixed_wage: 1 }).success).toBe(false)
  })
})

const TOTALS = { gross: 20000, deductions: 1800, gosi_employee: 1800, gosi_employer: 2400, net: 18200 }
const SUMMARY = { id: 4, month: '2026-10', state: 'computed', employee_count: 2, totals: TOTALS, approved_at: null }
const RUN = {
  ...SUMMARY,
  warnings: [{ code: 'missing_iban', employee: { id: 3, name: 'ليلى' } }],
  allowed_actions: ['compute', 'approve', 'cancel', 'edit_inputs'],
  approved_by: null,
  finance: null,
}
const INPUTS = { overtime_amount: 0, absence_days: 1, bonus_amount: 250.5, deduction_amount: 0, advance_recovery_amount: 0 }
const ROW = {
  id: 9, employee: { id: 3, name: 'ليلى' }, department: null, state: 'draft', paid_days: 30,
  inputs: INPUTS, gross: 10000, deductions: 900, net: 9100, iban_missing: true,
}
const PAYSLIP = {
  id: 9, number: 'SLIP/001', month: '2026-10', state: 'done', employee: { id: 3, name: 'ليلى' }, department: { id: 1, name: 'المالية' },
  paid_days: 30, lines: [{ code: 'BASIC', name: 'الأساسي', category: 'BASIC', amount: 8000 }],
  gross: 10000, deductions: 900, net: 9100, gosi_employer: 1200, company: { name: 'شركة', vat: '' },
}
const { id: _id, shared: _shared, ...RATE_WRITE } = { id: 2, shared: true, branch: 'annuities', nationality_class: 'saudi_from_2024', date_from: '2024-07-03', employee_rate: 9.5, employer_rate: 11.5, wage_min: 400, wage_max: 45000 }
const RATE = {
  id: 2, branch: 'annuities', nationality_class: 'saudi_from_2024', date_from: '2024-07-03',
  employee_rate: 9.5, employer_rate: 11.5, wage_min: 400, wage_max: 45000, shared: true,
}

describe('payroll run schemas', () => {
  it('accepts the run states, a summary list and a run detail', () => {
    for (const state of ['draft', 'computed', 'approved', 'posted', 'paid']) expect(HrPayrollRunStateSchema.parse(state)).toBe(state)
    expect(HrPayrollRunListSchema.parse({ items: [SUMMARY], total: 1 }).items).toHaveLength(1)
    expect(HrPayrollRunSchema.parse(RUN)).toEqual(RUN)
    const finance = { entry_id: 1, entry_name: 'MISC/1', payment_id: null, payment_name: null }
    expect(HrPayrollRunSchema.safeParse({ ...RUN, finance, approved_by: { id: 2, name: 'مدير' }, approved_at: '2026-10-31T10:00:00Z' }).success).toBe(true)
  })

  it('rejects an unknown state, an unknown key and a bad month', () => {
    expect(HrPayrollRunStateSchema.safeParse('cancelled').success).toBe(false)
    expect(HrPayrollRunSchema.safeParse({ ...RUN, extra: 1 }).success).toBe(false)
    expect(HrPayrollRunListSchema.safeParse({ items: [{ ...SUMMARY, totals: { gross: 1 } }], total: 1 }).success).toBe(false)
  })

  it('accepts a YYYY-MM create body only', () => {
    expect(HrPayrollRunCreateSchema.parse({ month: '2026-12' })).toEqual({ month: '2026-12' })
    expect(HrPayrollRunCreateSchema.safeParse({ month: '2026-13' }).success).toBe(false)
    expect(HrPayrollRunCreateSchema.safeParse({ month: '2026-1' }).success).toBe(false)
    expect(HrPayrollRunCreateSchema.safeParse({ month: '2026-10', extra: 1 }).success).toBe(false)
  })
})

describe('payslip schemas', () => {
  it('accepts register rows, an input patch and a payslip', () => {
    expect(HrPayslipRowListSchema.parse({ items: [ROW], total: 1 }).total).toBe(1)
    expect(HrPayslipRowSchema.parse({ ...ROW, department: { id: 1, name: 'المالية' }, iban_missing: false })).toBeTruthy()
    expect(HrPayslipInputsPatchSchema.parse({ bonus_amount: 100 })).toEqual({ bonus_amount: 100 })
    expect(HrPayslipSchema.parse(PAYSLIP)).toEqual(PAYSLIP)
    expect(HrMyPayslipListSchema.parse({ items: [{ id: 9, number: 'SLIP/001', month: '2026-10', net: 9100 }], total: 1 }).total).toBe(1)
  })

  it('rejects an empty, negative or unknown input patch and unknown row keys', () => {
    expect(HrPayslipInputsPatchSchema.safeParse({}).success).toBe(false)
    expect(HrPayslipInputsPatchSchema.safeParse({ bonus_amount: -1 }).success).toBe(false)
    expect(HrPayslipInputsPatchSchema.safeParse({ salary: 1 }).success).toBe(false)
    expect(HrPayslipRowSchema.safeParse({ ...ROW, iban: 'SA' }).success).toBe(false)
    expect(HrPayslipSchema.safeParse({ ...PAYSLIP, lines: [{ code: 'A', name: 'x', amount: 1 }] }).success).toBe(false)
  })
})

describe('payroll settings schemas', () => {
  const SETTINGS = {
    day_divisor: 30, structure: { id: 1, name: 'هيكل' }, unpaid_leave_types: [{ id: 2, name: 'بدون راتب' }], annual_leave_type: null,
  }

  it('accepts settings, a partial patch, and GOSI rates', () => {
    expect(HrPayrollSettingsSchema.parse(SETTINGS)).toEqual(SETTINGS)
    expect(HrPayrollSettingsPatchSchema.parse({ day_divisor: 28 })).toEqual({ day_divisor: 28 })
    expect(HrPayrollSettingsPatchSchema.safeParse({ unpaid_leave_type_ids: [2], annual_leave_type_id: 1 }).success).toBe(true)
    expect(HrGosiRateListSchema.parse({ items: [RATE], total: 1 }).items[0]).toEqual(RATE)
    expect(HrGosiRateWriteSchema.safeParse(RATE_WRITE).success).toBe(true)
  })

  it('rejects a divisor outside 28 to 31, an empty patch, unknown branches and negative rates', () => {
    expect(HrPayrollSettingsPatchSchema.safeParse({ day_divisor: 32 }).success).toBe(false)
    expect(HrPayrollSettingsPatchSchema.safeParse({}).success).toBe(false)
    expect(HrPayrollSettingsPatchSchema.safeParse({ annual_leave_type_id: null }).success).toBe(false)
    expect(HrGosiRateSchema.safeParse({ ...RATE, branch: 'other' }).success).toBe(false)
    expect(HrGosiRateWriteSchema.safeParse({ ...RATE_WRITE, employee_rate: -1 }).success).toBe(false)
    expect(HrGosiRateWriteSchema.safeParse({ ...RATE }).success).toBe(false)
  })
})

describe('payroll finance schemas', () => {
  const ROLES = ['basic_expense', 'allowance_expense', 'variable_expense', 'gosi_expense', 'gosi_payable', 'salaries_payable', 'deduction', 'advance', 'eos_expense', 'eos_provision']
  const accounts = Object.fromEntries(ROLES.map((role, index) => [role, index % 2 ? null : { id: index + 1, name: `حساب ${index}` }]))
  const SETTINGS = { journal: { id: 7, name: 'قيود الرواتب' }, accounts, default_analytic_account: null, entry_detail: 'aggregated' }

  it('accepts the finance settings, a partial patch and the cost centers', () => {
    expect(HrPayrollFinanceSettingsSchema.parse(SETTINGS)).toEqual(SETTINGS)
    expect(HrPayrollFinanceSettingsPatchSchema.parse({ accounts: { advance: null }, entry_detail: 'per_employee' })).toEqual({ accounts: { advance: null }, entry_detail: 'per_employee' })
    const centers = { items: [{ department: { id: 1, name: 'المالية' }, analytic_account: null }], total: 1 }
    expect(HrPayrollCostCenterListSchema.parse(centers)).toEqual(centers)
    expect(HrPayrollCostCenterWriteSchema.parse({ analytic_account_id: null })).toEqual({ analytic_account_id: null })
  })

  it('rejects an unknown role, an unknown detail, an empty patch and a missing role', () => {
    expect(HrPayrollFinanceSettingsSchema.safeParse({ ...SETTINGS, accounts: { ...accounts, other: null } }).success).toBe(false)
    expect(HrPayrollFinanceSettingsSchema.safeParse({ ...SETTINGS, entry_detail: 'x' }).success).toBe(false)
    expect(HrPayrollFinanceSettingsPatchSchema.safeParse({}).success).toBe(false)
    expect(HrPayrollFinanceSettingsPatchSchema.safeParse({ accounts: { other: 1 } }).success).toBe(false)
    expect(HrPayrollCostCenterWriteSchema.safeParse({}).success).toBe(false)
  })

  it('accepts the posting preview and the payment body', () => {
    const preview = {
      entry_detail: 'aggregated',
      date: '2026-10-31',
      journal: { id: 7, name: 'قيود الرواتب' },
      lines: [{ account: { id: 1, code: '510101', name: 'رواتب' }, analytic_account: null, employee: null, debit: 100, credit: 0 }],
      debit: 100,
      credit: 100,
      warnings: [{ code: 'unmapped_department', employee: { id: 3, name: 'ليلى' } }],
    }
    expect(HrPayrollPostingPreviewSchema.parse(preview)).toEqual(preview)
    expect(HrPayrollPostingPreviewSchema.safeParse({ ...preview, extra: 1 }).success).toBe(false)
    expect(HrPayrollPaymentCreateSchema.parse({ journal_id: 5, date: '2026-11-01' })).toEqual({ journal_id: 5, date: '2026-11-01' })
    expect(HrPayrollPaymentCreateSchema.safeParse({ journal_id: 5, date: '1/11/2026' }).success).toBe(false)
    expect(HrPayrollPaymentCreateSchema.safeParse({ journal_id: 0, date: '2026-11-01' }).success).toBe(false)
  })
})

describe('salary file schemas', () => {
  const PROFILE = {
    id: 4,
    name: 'ملف البنك',
    kind: 'bank',
    delimiter: ',',
    encoding: 'utf-8',
    include_header: true,
    footer: 'none',
    columns: [{ source: 'iban', label: 'IBAN', constant_value: '' }, { source: 'constant', label: 'Type', constant_value: 'SAL' }],
    shared: false,
  }
  const STATEMENT = {
    month: '2026-10',
    lines: [{
      employee: { id: 3, name: 'ليلى الحربي' },
      gosi_number: '123',
      nationality_class: 'saudi_from_2024',
      contributory_wage: 10000,
      branches: { annuities: { employee: 950, employer: 1150 }, saned: { employee: 75, employer: 75 }, hazards: { employee: 0, employer: 100 } },
      employee_amount: 1025,
      employer_amount: 1325,
    }],
    totals: { contributory_wage: 10000, employee_amount: 1025, employer_amount: 1325 },
  }

  it('accepts a bank profile, its list and the write body', () => {
    expect(HrBankProfileSchema.parse(PROFILE)).toEqual(PROFILE)
    expect(HrBankProfileListSchema.parse({ items: [PROFILE], total: 1 }).total).toBe(1)
    const { id: _id, shared: _shared, ...body } = PROFILE
    expect(HrBankProfileWriteSchema.parse(body)).toEqual(body)
  })

  it('rejects an unknown delimiter, a column without a label and a misplaced constant', () => {
    expect(HrBankProfileSchema.safeParse({ ...PROFILE, delimiter: 'x' }).success).toBe(false)
    expect(HrBankProfileSchema.safeParse({ ...PROFILE, columns: [{ source: 'iban', label: '', constant_value: '' }] }).success).toBe(false)
    const { id: _id, shared: _shared, ...body } = PROFILE
    expect(HrBankProfileWriteSchema.safeParse({ ...body, columns: [{ source: 'iban', label: 'IBAN', constant_value: 'x' }] }).success).toBe(false)
    expect(HrBankProfileWriteSchema.safeParse({ ...body, columns: [{ source: 'constant', label: 'T', constant_value: '' }] }).success).toBe(false)
    expect(HrBankProfileWriteSchema.safeParse({ ...body, columns: [] }).success).toBe(false)
  })

  it('accepts the GOSI statement and rejects an unknown key or branch', () => {
    expect(HrGosiStatementSchema.parse(STATEMENT)).toEqual(STATEMENT)
    expect(HrGosiStatementSchema.safeParse({ ...STATEMENT, extra: 1 }).success).toBe(false)
    const line = { ...STATEMENT.lines[0], branches: { other: { employee: 1, employer: 1 } } }
    expect(HrGosiStatementSchema.safeParse({ ...STATEMENT, lines: [line] }).success).toBe(false)
  })
})
