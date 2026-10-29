import { z } from 'zod'
import { HrRefSchema } from './ref'

// The payroll-only compensation of one employee (/api/v1/hr/payroll/compensation/<employee_id>).
// It is served only to `hr.payroll.*` callers and never appears on the general employee shapes.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const amount = z.number().min(0)

// The customer's own classification of the relationship; it never changes a calculation or blocks a run.
export const HrPayrollRelationshipSchema = z.enum(['employee', 'independent_contractor', 'consultant', 'other_cooperation'])

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
  relationship_type: HrPayrollRelationshipSchema,
  currency: z.string().length(3),
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
  relationship_type: HrPayrollRelationshipSchema,
}).strict()

export type HrPayrollRelationship = z.infer<typeof HrPayrollRelationshipSchema>
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
  currency: z.string().length(3),
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
  currency: z.string().length(3),
  company: z.object({ name: z.string(), vat: z.string() }).strict(),
}).strict()

export const HrMyPayslipSummarySchema = z.object({
  id: z.number().int().positive(),
  number: z.string(),
  month: payrollMonth,
  currency: z.string().length(3),
  net: z.number(),
}).strict()

export const HrMyPayslipListSchema = z.object({
  items: z.array(HrMyPayslipSummarySchema),
  total: z.number().int().nonnegative(),
}).strict()

const dayDivisor = z.number().int().min(28).max(31)
// The optimistic revision of a payroll settings row: a write sends the one it read, a stale one answers 409.
// A row the company has not saved yet (the settings, an end-of-service case) is revision 0.
const storedRevision = z.number().int().positive()
const baselineRevision = z.number().int().nonnegative()

export const HrPayrollSettingsSchema = z.object({
  day_divisor: dayDivisor,
  structure: HrRefSchema.nullable(),
  unpaid_leave_types: z.array(HrRefSchema),
  annual_leave_type: HrRefSchema.nullable(),
  revision: baselineRevision,
}).strict()

export const HrPayrollSettingsPatchSchema = z.object({
  day_divisor: dayDivisor,
  structure_id: z.number().int().positive(),
  unpaid_leave_type_ids: z.array(z.number().int().positive()),
  annual_leave_type_id: z.number().int().positive(),
}).partial().extend({ revision: baselineRevision }).strict()
  .refine(({ revision: _, ...patch }) => Object.keys(patch).length > 0, 'no settings to update')

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
  revision: storedRevision,
}).strict()

export const HrGosiRateListSchema = z.object({
  items: z.array(HrGosiRateSchema),
  total: z.number().int().nonnegative(),
}).strict()

// A create sends every field; a PATCH sends the ones it changes, with the revision it read.
export const HrGosiRateWriteSchema = HrGosiRateSchema.omit({ id: true, shared: true, revision: true })
export const HrGosiRatePatchSchema = HrGosiRateWriteSchema.partial().extend({ revision: storedRevision }).strict()

// A DELETE of a GOSI rate or a salary file profile sends the revision it read, in its JSON body.
export const HrPayrollRevisionSchema = z.object({ revision: storedRevision }).strict()

// ---- Salary files: bank/WPS file layouts and the GOSI statement of a fixed run ----
export const HR_BANK_PROFILE_KINDS = ['bank', 'wps'] as const
export const HR_BANK_PROFILE_DELIMITERS = [',', ';', '\t', '|'] as const
export const HR_BANK_PROFILE_ENCODINGS = ['utf-8', 'utf-8-sig'] as const
export const HR_BANK_PROFILE_FOOTERS = ['none', 'totals'] as const
export const HR_BANK_COLUMN_SOURCES = [
  'employee_ref', 'identification', 'name', 'iban', 'bank_code', 'basic', 'housing',
  'other_allowances', 'deductions', 'net', 'value_date', 'constant',
] as const

export const HrBankProfileColumnSchema = z.object({
  source: z.enum(HR_BANK_COLUMN_SOURCES),
  label: z.string().min(1),
  constant_value: z.string(),
}).strict()

export const HrBankProfileSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  kind: z.enum(HR_BANK_PROFILE_KINDS),
  delimiter: z.enum(HR_BANK_PROFILE_DELIMITERS),
  encoding: z.enum(HR_BANK_PROFILE_ENCODINGS),
  include_header: z.boolean(),
  footer: z.enum(HR_BANK_PROFILE_FOOTERS),
  columns: z.array(HrBankProfileColumnSchema),
  // A shared row belongs to no company: it is read-only for a tenant.
  shared: z.boolean(),
  revision: storedRevision,
}).strict()

export const HrBankProfileListSchema = z.object({
  items: z.array(HrBankProfileSchema),
  total: z.number().int().nonnegative(),
}).strict()

// A create sends every field; a PATCH sends the ones it changes. A constant column carries a value, any other none.
const bankProfileFields = HrBankProfileSchema.omit({ id: true, shared: true, revision: true }).extend({
  name: z.string().trim().min(1),
  columns: z.array(HrBankProfileColumnSchema).min(1),
})
const constantColumns = { message: 'only a constant column carries a value, and it needs one', path: ['columns'] }
const columnsCarryConstants = (columns: z.infer<typeof HrBankProfileColumnSchema>[] | undefined) =>
  (columns ?? []).every(column => (column.source === 'constant') === (column.constant_value.trim() !== ''))
export const HrBankProfileWriteSchema = bankProfileFields.refine(profile => columnsCarryConstants(profile.columns), constantColumns)
export const HrBankProfilePatchSchema = bankProfileFields.partial().extend({ revision: storedRevision }).strict()
  .refine(profile => columnsCarryConstants(profile.columns), constantColumns)

const gosiSide = z.object({ employee: amount, employer: amount }).strict()

export const HrGosiStatementLineSchema = z.object({
  employee: HrRefSchema,
  gosi_number: z.string(),
  nationality_class: z.enum(HR_GOSI_NATIONALITY_CLASSES),
  contributory_wage: amount,
  branches: z.object({ annuities: gosiSide, saned: gosiSide, hazards: gosiSide }).strict(),
  employee_amount: amount,
  employer_amount: amount,
}).strict()

export const HrGosiStatementSchema = z.object({
  month: payrollMonth,
  lines: z.array(HrGosiStatementLineSchema),
  totals: z.object({ contributory_wage: amount, employee_amount: amount, employer_amount: amount }).strict(),
}).strict()

// ---- The finance side of payroll, served by the webvue_hr_finance bridge (absent: the routes answer 404) ----
export const HR_PAYROLL_ACCOUNT_ROLES = [
  'basic_expense', 'allowance_expense', 'variable_expense', 'gosi_expense', 'gosi_payable',
  'salaries_payable', 'deduction', 'advance', 'eos_expense', 'eos_provision',
] as const
export const HR_PAYROLL_ENTRY_DETAILS = ['aggregated', 'per_employee'] as const

const accountRoleShape = <T extends z.ZodType>(value: T) => z.object(
  Object.fromEntries(HR_PAYROLL_ACCOUNT_ROLES.map(role => [role, value])) as Record<typeof HR_PAYROLL_ACCOUNT_ROLES[number], T>,
).strict()
const recordId = z.number().int().positive()

export const HrPayrollFinanceSettingsSchema = z.object({
  journal: HrRefSchema.nullable(),
  accounts: accountRoleShape(HrRefSchema.nullable()),
  default_analytic_account: HrRefSchema.nullable(),
  entry_detail: z.enum(HR_PAYROLL_ENTRY_DETAILS),
}).strict()

// A PATCH names the parts it changes; null clears a reference.
export const HrPayrollFinanceSettingsPatchSchema = z.object({
  journal_id: recordId.nullable(),
  accounts: accountRoleShape(recordId.nullable()).partial().strict(),
  default_analytic_account_id: recordId.nullable(),
  entry_detail: z.enum(HR_PAYROLL_ENTRY_DETAILS),
}).partial().strict().refine(patch => Object.keys(patch).length > 0, 'no settings to update')

export const HrPayrollCostCenterSchema = z.object({
  department: HrRefSchema,
  analytic_account: HrRefSchema.nullable(),
}).strict()

export const HrPayrollCostCenterListSchema = z.object({
  items: z.array(HrPayrollCostCenterSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrPayrollCostCenterWriteSchema = z.object({ analytic_account_id: recordId.nullable() }).strict()

export const HrPayrollPostingLineSchema = z.object({
  account: z.object({ id: recordId, code: z.string(), name: z.string() }).strict(),
  analytic_account: HrRefSchema.nullable(),
  employee: HrRefSchema.nullable(),
  debit: amount,
  credit: amount,
}).strict()

export const HrPayrollPostingPreviewSchema = z.object({
  entry_detail: z.enum(HR_PAYROLL_ENTRY_DETAILS),
  date: isoDate,
  journal: HrRefSchema,
  lines: z.array(HrPayrollPostingLineSchema),
  debit: amount,
  credit: amount,
  warnings: z.array(HrPayrollWarningSchema),
}).strict()

export const HrPayrollPaymentCreateSchema = z.object({ journal_id: recordId, date: isoDate }).strict()

// ---- Payroll audit trail (GET /api/v1/hr/payroll/audit-events, `hr.payroll.audit.read`) ----
export const HR_PAYROLL_AUDIT_ACTIONS = [
  'payroll_settings_changed', 'gosi_rate_created', 'gosi_rate_changed', 'gosi_rate_deleted',
  'bank_profile_created', 'bank_profile_changed', 'bank_profile_deleted', 'eos_case_changed',
  'settlement_saved', 'settlement_confirmed', 'compensation_changed',
  'run_inputs_changed', 'run_approved', 'run_cancelled', 'payment_file_generated',
] as const

// Values are present only for non-secret policy fields; pay, IBAN and settlement fields carry the name alone.
export const HrPayrollAuditChangeSchema = z.object({
  field: z.string().min(1),
  old_value: z.string().nullable(),
  new_value: z.string().nullable(),
}).strict()

export const HrPayrollAuditEventSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(HR_PAYROLL_AUDIT_ACTIONS),
  actor: HrRefSchema,
  created_at: z.string().datetime(),
  res_model: z.string(),
  res_id: z.number().int().positive(),
  changes: z.array(HrPayrollAuditChangeSchema),
}).strict()

// Query: `action`, `date_from`, `date_to` (inclusive days in the user's timezone), `limit`, `offset`.
export const HrPayrollAuditEventListSchema = z.object({
  items: z.array(HrPayrollAuditEventSchema),
  total: z.number().int().nonnegative(),
}).strict()

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
export type HrGosiRatePatch = z.infer<typeof HrGosiRatePatchSchema>
export type HrPayrollAccountRole = typeof HR_PAYROLL_ACCOUNT_ROLES[number]
export type HrPayrollEntryDetail = typeof HR_PAYROLL_ENTRY_DETAILS[number]
export type HrPayrollFinanceSettings = z.infer<typeof HrPayrollFinanceSettingsSchema>
export type HrPayrollFinanceSettingsPatch = z.infer<typeof HrPayrollFinanceSettingsPatchSchema>
export type HrPayrollCostCenter = z.infer<typeof HrPayrollCostCenterSchema>
export type HrPayrollCostCenterList = z.infer<typeof HrPayrollCostCenterListSchema>
export type HrPayrollPostingPreview = z.infer<typeof HrPayrollPostingPreviewSchema>
export type HrPayrollPaymentCreate = z.infer<typeof HrPayrollPaymentCreateSchema>
export type HrBankProfileColumn = z.infer<typeof HrBankProfileColumnSchema>
export type HrBankProfile = z.infer<typeof HrBankProfileSchema>
export type HrBankProfileList = z.infer<typeof HrBankProfileListSchema>
export type HrBankProfileWrite = z.infer<typeof HrBankProfileWriteSchema>
export type HrBankProfilePatch = z.infer<typeof HrBankProfilePatchSchema>
export type HrPayrollAuditAction = typeof HR_PAYROLL_AUDIT_ACTIONS[number]
export type HrPayrollAuditChange = z.infer<typeof HrPayrollAuditChangeSchema>
export type HrPayrollAuditEvent = z.infer<typeof HrPayrollAuditEventSchema>
export type HrPayrollAuditEventList = z.infer<typeof HrPayrollAuditEventListSchema>
export type HrGosiStatementLine = z.infer<typeof HrGosiStatementLineSchema>
export type HrGosiStatement = z.infer<typeof HrGosiStatementSchema>

// ---- End of service: the award estimate, the final settlement of a leaver, the departure-reason case map and the provision ----
export const HR_EOS_CASES = ['termination', 'contract_expiry', 'resignation', 'force_majeure', 'marriage_childbirth', 'no_award'] as const
export const HrEosCaseSchema = z.enum(HR_EOS_CASES)

export const HrEosEstimateSchema = z.object({
  employee: HrRefSchema,
  start_date: isoDate,
  end_date: isoDate,
  service_years: z.number().min(0),
  eos_wage: amount,
  case: HrEosCaseSchema,
  award: amount,
  leave_days: z.number(),
  currency: z.string().length(3),
  leave_amount: amount,
}).strict()

export const HrSettlementSchema = z.object({
  id: z.number().int().positive(),
  employee: HrRefSchema,
  departure_date: isoDate.nullable(),
  // True when the employee's departure date changed after the settlement was confirmed.
  departure_mismatch: z.boolean(),
  case: HrEosCaseSchema,
  service_years: z.number().min(0),
  eos_wage: amount,
  award: amount,
  leave_days: z.number(),
  leave_amount: amount,
  open_deductions: amount,
  total: z.number(),
  currency: z.string().length(3),
  state: z.enum(['draft', 'confirmed']),
}).strict()

// A draft settlement is saved with its case and the deductions still open; the figures are the server's.
export const HrSettlementWriteSchema = z.object({ case: HrEosCaseSchema, open_deductions: amount }).strict()

// `revision` is the company's own mapping row's: 0 while the company has not mapped the reason itself.
export const HrEosCaseMapSchema = z.object({ departure_reason: HrRefSchema, case: HrEosCaseSchema.nullable(), revision: baselineRevision }).strict()

export const HrEosCaseMapListSchema = z.object({ items: z.array(HrEosCaseMapSchema), total: z.number().int().nonnegative() }).strict()

export const HrEosCaseMapWriteSchema = z.object({ departure_reason_id: z.number().int().positive(), case: HrEosCaseSchema, revision: baselineRevision }).strict()

// The monthly provision posted by the finance bridge.
export const HrEosProvisionSchema = z.object({
  month: payrollMonth,
  entry_id: z.number().int().positive(),
  entry_name: z.string(),
  amount: z.number(),
}).strict()

export const HrEosProvisionListSchema = z.object({ items: z.array(HrEosProvisionSchema), total: z.number().int().nonnegative() }).strict()

export const HrEosProvisionCreateSchema = z.object({ month: payrollMonth }).strict()

export type HrEosCase = z.infer<typeof HrEosCaseSchema>
export type HrEosEstimate = z.infer<typeof HrEosEstimateSchema>
export type HrSettlement = z.infer<typeof HrSettlementSchema>
export type HrSettlementWrite = z.infer<typeof HrSettlementWriteSchema>
export type HrEosCaseMap = z.infer<typeof HrEosCaseMapSchema>
export type HrEosCaseMapList = z.infer<typeof HrEosCaseMapListSchema>
export type HrEosCaseMapWrite = z.infer<typeof HrEosCaseMapWriteSchema>
export type HrEosProvision = z.infer<typeof HrEosProvisionSchema>
export type HrEosProvisionList = z.infer<typeof HrEosProvisionListSchema>
export type HrEosProvisionCreate = z.infer<typeof HrEosProvisionCreateSchema>
