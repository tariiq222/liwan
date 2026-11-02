import { z } from 'zod'
import { MIN_PASSWORD_LENGTH } from '../common/password'
import { PersonRefSchema } from '../common/person'
import { HrRefSchema } from './ref'

// The five HR areas: each area keeps its own schema module (one source of truth per
// route contract), and this barrel re-exports them beside the directory, leave and
// report shapes below.
export * from './assets'
export * from './bell'
export * from './offboarding'
export * from './onboarding'
export * from './insurance'
export * from './payroll'
export * from './recruitment'
export * from './ref'
export * from './shifts'
export * from './warnings'

export const HrAccessRoleSchema = z.enum(['employee', 'admin', 'vendor'])
export const HrWritableRoleSchema = z.enum(['employee', 'admin'])

export const HrEmployeeAccessSchema = z.object({
  user_id: z.number().int().positive(),
  login: z.string(),
  role: HrAccessRoleSchema,
  active: z.boolean(),
}).strict()

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const nonEmptyTrimmedName = z.string().trim().min(1)
const optionalEmail = z.string().email().or(z.literal('')).optional()
const relationId = z.number().int().positive().nullable().optional()

const requirePatchField = (value: object) => Object.keys(value).length > 0

export const HrDepartmentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  parent_id: z.number().int().positive().nullable(),
  manager: HrRefSchema.nullable(),
  child_ids: z.array(z.number().int().positive()),
  employee_count: z.number().int().nonnegative(),
}).strict()

export const HrEmployeeContractSchema = z.object({
  type: HrRefSchema.nullable(),
  start_date: isoDate.nullable(),
  end_date: isoDate.nullable(),
  probation_end_date: isoDate.nullable(),
  notice_period_days: z.number().int().nonnegative(),
  identity_expiry_date: isoDate.nullable(),
}).strict()

export const HrEmployeeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  job_title: z.string(),
  department: HrRefSchema.nullable(),
  work_email: z.string(),
  work_phone: z.string(),
  user_id: z.number().int().positive().nullable(),
  manager: HrRefSchema.nullable(),
  active: z.boolean(),
  access: HrEmployeeAccessSchema.nullable(),
  // The stock nationality payroll reads for the GOSI class; present with the contract block, null otherwise.
  nationality: HrRefSchema.nullable(),
  // Present on the detail shape for callers who manage employees; null on lists.
  contract: HrEmployeeContractSchema.nullable(),
}).strict()

export const HrEmployeeCreateSchema = z.object({
  name: nonEmptyTrimmedName,
  work_email: optionalEmail,
  work_phone: z.string().optional(),
  job_title: z.string().optional(),
  department_id: relationId,
  parent_id: relationId,
  nationality_id: relationId,
}).strict()

// Dates and the type may be cleared with null; no salary or bank fields exist here.
export const HrEmployeeContractPatchSchema = z.object({
  start_date: isoDate.nullable().optional(),
  end_date: isoDate.nullable().optional(),
  probation_end_date: isoDate.nullable().optional(),
  contract_type_id: relationId,
  notice_period_days: z.number().int().nonnegative().optional(),
  identity_expiry_date: isoDate.nullable().optional(),
}).strict().refine(requirePatchField, { message: 'At least one field is required' })

export const HrEmployeePatchSchema = z.object({
  name: nonEmptyTrimmedName.optional(),
  work_email: optionalEmail,
  work_phone: z.string().optional(),
  job_title: z.string().optional(),
  department_id: relationId,
  parent_id: relationId,
  nationality_id: relationId,
  contract: HrEmployeeContractPatchSchema.optional(),
}).strict().refine(requirePatchField, { message: 'At least one field is required' })

const password = z.string().trim().min(MIN_PASSWORD_LENGTH)

export const HrAccessGrantSchema = z.object({
  password,
  role: HrWritableRoleSchema,
}).strict()

export const HrAccessPatchSchema = z.object({
  password: password.optional(),
  role: HrWritableRoleSchema.optional(),
}).strict().refine(requirePatchField, { message: 'At least one field is required' })

export const HrDepartmentCreateSchema = z.object({
  name: nonEmptyTrimmedName,
  parent_id: relationId,
  manager_id: relationId,
}).strict()

export const HrDepartmentPatchSchema = z.object({
  name: nonEmptyTrimmedName.optional(),
  parent_id: relationId,
  manager_id: relationId,
}).strict().refine(requirePatchField, { message: 'At least one field is required' })

export const HrDepartmentListSchema = z.object({
  items: z.array(HrDepartmentSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrEmployeeListSchema = z.object({
  items: z.array(HrEmployeeSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrExpiryKindSchema = z.enum(['document', 'contract_end', 'probation_end', 'identity'])

export const HrExpiringItemSchema = z.object({
  kind: HrExpiryKindSchema,
  employee: HrRefSchema.nullable(),
  document: HrRefSchema.nullable(),
  due_date: isoDate,
  // Negative when the item is already overdue.
  days_left: z.number().int(),
}).strict()

export const HrExpiringListSchema = z.object({
  items: z.array(HrExpiringItemSchema),
  total: z.number().int().nonnegative(),
}).strict()

const saudizationCounts = {
  total: z.number().int().nonnegative(),
  saudi: z.number().int().nonnegative(),
  non_saudi: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  // Share of saudi among employees with a known nationality (unknown is excluded
  // from the denominator); null when none is known.
  saudi_percent: z.number().min(0).max(100).nullable(),
}

export const HrSaudizationRowSchema = z.object({
  department: HrRefSchema.nullable(),
  ...saudizationCounts,
}).strict()

export const HrSaudizationSchema = z.object({
  overall: z.object(saudizationCounts).strict(),
  items: z.array(HrSaudizationRowSchema),
  total: z.number().int().nonnegative(),
}).strict()

export type HrDepartment = z.infer<typeof HrDepartmentSchema>
export type HrEmployee = z.infer<typeof HrEmployeeSchema>
// Leave runs on stock hr_holidays; these are the /api/v1/hr/leave shapes.
export const HrLeaveStateSchema = z.enum(['confirm', 'validate1', 'validate', 'refuse', 'cancel'])

export const HrLeaveCancellationPolicySchema = z.enum(['manager_approval', 'direct_employee', 'manager_only'])
export const HrLeaveSettingsSchema = z.object({
  cancellation_policy: HrLeaveCancellationPolicySchema,
  revision: z.number().int().nonnegative(),
}).strict()
export const HrLeaveSettingsPatchSchema = HrLeaveSettingsSchema
export const HrLeaveCancellationSchema = z.object({
  id: z.number().int().positive(), state: z.enum(['pending', 'approved', 'refused']),
  revision: z.number().int().positive(), reason: z.string(), requested_at: z.string(),
  initiator: HrRefSchema, reviewed_at: z.string().nullable(), reviewer: HrRefSchema.nullable(), review_reason: z.string().nullable(),
}).strict()
export const HrLeaveCancellationDecisionSchema = z.object({ revision: z.number().int().positive(), reason: z.string().optional() }).strict()
export const HrLeaveCancellationRefusalSchema = z.object({ revision: z.number().int().positive(), reason: z.string().trim().min(1) }).strict()
export const HrLeaveCancelSchema = z.object({ reason: z.string().optional(), revision: z.number().int().positive().optional() }).strict()
export type HrLeaveCancellationPolicy = z.infer<typeof HrLeaveCancellationPolicySchema>
export type HrLeaveSettings = z.infer<typeof HrLeaveSettingsSchema>
export type HrLeaveSettingsPatch = z.infer<typeof HrLeaveSettingsPatchSchema>
export type HrLeaveCancellation = z.infer<typeof HrLeaveCancellationSchema>

export const HrLeaveTypeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  requires_allocation: z.boolean(),
  support_document: z.boolean(),
}).strict()

export const HrLeaveSchema = z.object({
  id: z.number().int().positive(),
  employee: HrRefSchema,
  leave_type: HrRefSchema,
  date_from: isoDate,
  date_to: isoDate,
  number_of_days: z.number().nonnegative(),
  state: HrLeaveStateSchema,
  notes: z.string(),
  can_approve: z.boolean(),
  can_refuse: z.boolean(),
  can_cancel: z.boolean(),
  can_withdraw: z.boolean(),
  cancellation_policy: HrLeaveCancellationPolicySchema,
  cancellation: HrLeaveCancellationSchema.nullable(),
  can_request_cancellation: z.boolean(),
  can_approve_cancellation: z.boolean(),
  can_refuse_cancellation: z.boolean(),
}).strict()

export const HrLeaveBalanceSchema = z.object({
  leave_type: HrRefSchema,
  allocated: z.number(),
  taken: z.number(),
  pending: z.number(),
  remaining: z.number(),
}).strict()

export const HrLeaveAllocationSchema = z.object({
  id: z.number().int().positive(),
  employee: HrRefSchema,
  leave_type: HrRefSchema,
  number_of_days: z.number().positive(),
  date_from: isoDate,
  date_to: isoDate.nullable(),
  state: z.enum(['confirm', 'validate1', 'validate', 'refuse']),
}).strict()

export const HrLeaveRequestCreateSchema = z.object({
  leave_type_id: z.number().int().positive(),
  date_from: isoDate,
  date_to: isoDate,
  notes: z.string().optional(),
  employee_id: z.number().int().positive().optional(),
}).strict().refine(value => value.date_to >= value.date_from, { message: 'date_to is before date_from', path: ['date_to'] })

export const HrLeaveAllocationCreateSchema = z.object({
  employee_id: z.number().int().positive(),
  leave_type_id: z.number().int().positive(),
  number_of_days: z.number().positive(),
  date_from: isoDate,
  date_to: isoDate.nullable().optional(),
}).strict()

// The employee and the leave type identify the grant; an edit changes only its days and validity.
export const HrLeaveAllocationPatchSchema = z.object({
  number_of_days: z.number().positive().optional(),
  date_from: isoDate.optional(),
  date_to: isoDate.nullable().optional(),
}).strict().refine(requirePatchField, { message: 'At least one field is required' })

export const HrLeaveWithdrawalSchema = z.object({
  id: z.number().int().positive(),
  withdrawn: z.literal(true),
}).strict()

export const HrLeaveTypeListSchema = z.object({ items: z.array(HrLeaveTypeSchema), total: z.number().int().nonnegative() }).strict()
export const HrLeaveListSchema = z.object({ items: z.array(HrLeaveSchema), total: z.number().int().nonnegative() }).strict()
export const HrLeaveBalanceListSchema = z.object({ items: z.array(HrLeaveBalanceSchema), total: z.number().int().nonnegative() }).strict()
export const HrLeaveAllocationListSchema = z.object({ items: z.array(HrLeaveAllocationSchema), total: z.number().int().nonnegative() }).strict()

// Leave approval runs on the operations workflow engine (bridge liwan_hr_operations); these are its HR-side shapes.
export const HrLeaveApprovalSchema = z.object({
  request_id: z.number().int().positive(),
  state: z.enum(['draft', 'pending', 'returned', 'rejected', 'withdrawn', 'done']),
  href: z.string(),
  steps: z.array(z.object({
    sequence: z.number().int().positive(),
    name: z.string(),
    reviewers: z.array(PersonRefSchema),
    status: z.enum(['waiting', 'pending', 'approved', 'rejected', 'cancel', 'skipped']),
  }).strict()),
}).strict()
export const HrLeaveApprovalProcessSchema = z.object({
  process: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    revision: z.number().int().nonnegative(),
    steps: z.array(z.object({
      name: z.string(),
      resolver: z.string().nullable(),
      resolver_label: z.string().nullable(),
      reviewers: z.array(PersonRefSchema),
    }).strict()),
  }).strict().nullable(),
  href: z.string(),
  can_manage: z.boolean(),
}).strict()

export type HrEmployeeAccess = z.infer<typeof HrEmployeeAccessSchema>
export type HrEmployeeCreate = z.infer<typeof HrEmployeeCreateSchema>
export type HrEmployeePatch = z.infer<typeof HrEmployeePatchSchema>
export type HrAccessGrant = z.infer<typeof HrAccessGrantSchema>
export type HrAccessPatch = z.infer<typeof HrAccessPatchSchema>
export type HrDepartmentCreate = z.infer<typeof HrDepartmentCreateSchema>
export type HrDepartmentPatch = z.infer<typeof HrDepartmentPatchSchema>
export type HrDepartmentList = z.infer<typeof HrDepartmentListSchema>
export type HrEmployeeList = z.infer<typeof HrEmployeeListSchema>
export type HrEmployeeContractPatch = z.infer<typeof HrEmployeeContractPatchSchema>
export type HrEmployeeContract = z.infer<typeof HrEmployeeContractSchema>
export type HrExpiryKind = z.infer<typeof HrExpiryKindSchema>
export type HrExpiringItem = z.infer<typeof HrExpiringItemSchema>
export type HrExpiringList = z.infer<typeof HrExpiringListSchema>
export type HrSaudizationRow = z.infer<typeof HrSaudizationRowSchema>
export type HrSaudization = z.infer<typeof HrSaudizationSchema>

export type HrLeaveState = z.infer<typeof HrLeaveStateSchema>
export type HrLeaveType = z.infer<typeof HrLeaveTypeSchema>
export type HrLeave = z.infer<typeof HrLeaveSchema>
export type HrLeaveBalance = z.infer<typeof HrLeaveBalanceSchema>
export type HrLeaveAllocation = z.infer<typeof HrLeaveAllocationSchema>
export type HrLeaveRequestCreate = z.infer<typeof HrLeaveRequestCreateSchema>
export type HrLeaveAllocationCreate = z.infer<typeof HrLeaveAllocationCreateSchema>
export type HrLeaveAllocationPatch = z.infer<typeof HrLeaveAllocationPatchSchema>
export type HrLeaveAllocationList = z.infer<typeof HrLeaveAllocationListSchema>
export type HrLeaveWithdrawal = z.infer<typeof HrLeaveWithdrawalSchema>
export type HrLeaveApproval = z.infer<typeof HrLeaveApprovalSchema>
export type HrLeaveApprovalProcess = z.infer<typeof HrLeaveApprovalProcessSchema>
export type HrLeaveTypeList = z.infer<typeof HrLeaveTypeListSchema>
export type HrLeaveList = z.infer<typeof HrLeaveListSchema>
export type HrLeaveBalanceList = z.infer<typeof HrLeaveBalanceListSchema>
