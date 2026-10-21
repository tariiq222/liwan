import { z } from 'zod'
import { HrRefSchema } from './ref'

// The payroll-only compensation of one employee (/api/v1/hr/payroll/compensation/<employee_id>).
// It is served only to `hr.payroll.*` callers and never appears on the general employee shapes.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const amount = z.number().min(0)

export const HrCompensationNationalitySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  code: z.string(),
}).strict()

export const HrCompensationSchema = z.object({
  employee: HrRefSchema,
  basic_wage: amount,
  housing_allowance: amount,
  transport_allowance: amount,
  other_allowance: amount,
  fixed_wage: amount,
  iban: z.string().nullable(),
  bank: HrRefSchema.nullable(),
  gosi_number: z.string().nullable(),
  gosi_registration_date: isoDate.nullable(),
  nationality: HrCompensationNationalitySchema.nullable(),
}).strict()

// A write sends every field; the fixed wage and the nationality are derived by the server.
export const HrCompensationWriteSchema = z.object({
  basic_wage: amount.positive(),
  housing_allowance: amount,
  transport_allowance: amount,
  other_allowance: amount,
  iban: z.string().regex(/^SA\d{22}$/).nullable(),
  bank_id: z.number().int().positive().nullable(),
  gosi_number: z.string().nullable(),
  gosi_registration_date: isoDate.nullable(),
}).strict()

export type HrCompensation = z.infer<typeof HrCompensationSchema>
export type HrCompensationWrite = z.infer<typeof HrCompensationWriteSchema>

// ---- Monthly payroll runs, the payslips of a run and the payroll settings (/api/v1/hr/payroll/...) ----
// The run states: posted and paid are reached only through the finance bridge.
export const HrPayrollRunStateSchema = z.enum(['draft', 'computed', 'approved', 'posted', 'paid'])

const payrollMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

export const HrPayrollTotalsSchema = z.object({
  gross: z.number(),
  deductions: z.number(),
  gosi_employee: z.number(),
  gosi_employer: z.number(),
  net: z.number(),
}).strict()

export const HrPayrollRunSummarySchema = z.object({
  id: z.number().int().positive(),
  month: payrollMonth,
  state: HrPayrollRunStateSchema,
  employee_count: z.number().int().nonnegative(),
  totals: HrPayrollTotalsSchema,
  approved_at: z.string().nullable(),
}).strict()

export const HrPayrollRunListSchema = z.object({
  items: z.array(HrPayrollRunSummarySchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrPayrollWarningSchema = z.object({ code: z.string(), employee: HrRefSchema }).strict()

// The accounting records of a run, filled by the finance bridge only.
export const HrPayrollFinanceSchema = z.object({
  entry_id: z.number().int().positive().nullable(),
  entry_name: z.string().nullable(),
  payment_id: z.number().int().positive().nullable(),
  payment_name: z.string().nullable(),
}).strict()

export const HrPayrollRunSchema = HrPayrollRunSummarySchema.extend({
  warnings: z.array(HrPayrollWarningSchema),
  allowed_actions: z.array(z.string()),
  approved_by: HrRefSchema.nullable(),
  finance: HrPayrollFinanceSchema.nullable(),
}).strict()

export const HrPayrollRunCreateSchema = z.object({ month: payrollMonth }).strict()

export const HrPayslipInputsSchema = z.object({
  overtime_amount: amount,
  absence_days: amount,
  bonus_amount: amount,
  deduction_amount: amount,
  advance_recovery_amount: amount,
}).strict()

// A write sends the inputs it changes, at least one.
export const HrPayslipInputsPatchSchema = HrPayslipInputsSchema.partial().strict()
  .refine(patch => Object.keys(patch).length > 0, 'no inputs to update')

export const HrPayslipRowSchema = z.object({
  id: z.number().int().positive(),
  employee: HrRefSchema,
  department: HrRefSchema.nullable(),
  state: z.string(),
  paid_days: z.number(),
  inputs: HrPayslipInputsSchema,
  gross: z.number(),
  deductions: z.number(),
  net: z.number(),
  iban_missing: z.boolean(),
}).strict()

export const HrPayslipRowListSchema = z.object({
  items: z.array(HrPayslipRowSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrPayslipLineSchema = z.object({
  code: z.string(),
  name: z.string(),
  category: z.string(),
  amount: z.number(),
}).strict()

export const HrPayslipSchema = z.object({
  id: z.number().int().positive(),
  number: z.string(),
  month: payrollMonth,
  state: z.string(),
  employee: HrRefSchema,
  department: HrRefSchema.nullable(),
  paid_days: z.number(),
  lines: z.array(HrPayslipLineSchema),
  gross: z.number(),
  deductions: z.number(),
  net: z.number(),
  gosi_employer: z.number(),
  company: z.object({ name: z.string(), vat: z.string() }).strict(),
}).strict()

export const HrMyPayslipSummarySchema = z.object({
  id: z.number().int().positive(),
  number: z.string(),
  month: payrollMonth,
  net: z.number(),
}).strict()

export const HrMyPayslipListSchema = z.object({
  items: z.array(HrMyPayslipSummarySchema),
  total: z.number().int().nonnegative(),
}).strict()

const dayDivisor = z.number().int().min(28).max(31)

export const HrPayrollSettingsSchema = z.object({
  day_divisor: dayDivisor,
  structure: HrRefSchema.nullable(),
  unpaid_leave_types: z.array(HrRefSchema),
  annual_leave_type: HrRefSchema.nullable(),
}).strict()

export const HrPayrollSettingsPatchSchema = z.object({
  day_divisor: dayDivisor,
  structure_id: z.number().int().positive(),
  unpaid_leave_type_ids: z.array(z.number().int().positive()),
  annual_leave_type_id: z.number().int().positive().nullable(),
}).partial().strict().refine(patch => Object.keys(patch).length > 0, 'no settings to update')

export const HR_GOSI_BRANCHES = ['annuities', 'saned', 'hazards'] as const
export const HR_GOSI_NATIONALITY_CLASSES = ['saudi_before_2024', 'saudi_from_2024', 'non_saudi', 'gcc'] as const

export const HrGosiRateSchema = z.object({
  id: z.number().int().positive(),
  branch: z.enum(HR_GOSI_BRANCHES),
  nationality_class: z.enum(HR_GOSI_NATIONALITY_CLASSES),
  date_from: isoDate,
  employee_rate: amount,
  employer_rate: amount,
  wage_min: amount,
  wage_max: amount,
  // A shared row belongs to no company: it is read-only for a tenant.
  shared: z.boolean(),
}).strict()

export const HrGosiRateListSchema = z.object({
  items: z.array(HrGosiRateSchema),
  total: z.number().int().nonnegative(),
}).strict()

// A create sends every field; a PATCH sends the ones it changes.
export const HrGosiRateWriteSchema = HrGosiRateSchema.omit({ id: true, shared: true })

export type HrPayrollRunState = z.infer<typeof HrPayrollRunStateSchema>
export type HrPayrollTotals = z.infer<typeof HrPayrollTotalsSchema>
export type HrPayrollRunSummary = z.infer<typeof HrPayrollRunSummarySchema>
export type HrPayrollRunList = z.infer<typeof HrPayrollRunListSchema>
export type HrPayrollWarning = z.infer<typeof HrPayrollWarningSchema>
export type HrPayrollRun = z.infer<typeof HrPayrollRunSchema>
export type HrPayrollRunCreate = z.infer<typeof HrPayrollRunCreateSchema>
export type HrPayslipInputs = z.infer<typeof HrPayslipInputsSchema>
export type HrPayslipInputsPatch = z.infer<typeof HrPayslipInputsPatchSchema>
export type HrPayslipRow = z.infer<typeof HrPayslipRowSchema>
export type HrPayslipRowList = z.infer<typeof HrPayslipRowListSchema>
export type HrPayslip = z.infer<typeof HrPayslipSchema>
export type HrMyPayslipSummary = z.infer<typeof HrMyPayslipSummarySchema>
export type HrMyPayslipList = z.infer<typeof HrMyPayslipListSchema>
export type HrPayrollSettings = z.infer<typeof HrPayrollSettingsSchema>
export type HrPayrollSettingsPatch = z.infer<typeof HrPayrollSettingsPatchSchema>
export type HrGosiRate = z.infer<typeof HrGosiRateSchema>
export type HrGosiRateList = z.infer<typeof HrGosiRateListSchema>
export type HrGosiRateWrite = z.infer<typeof HrGosiRateWriteSchema>
