import { z } from 'zod'
import { MIN_PASSWORD_LENGTH } from '../common/password'

export const HrRefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

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

export const HrDocumentAttachmentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  mimetype: z.string(),
  file_size: z.number(),
  url: z.string().min(1),
}).strict()

export const HrDocumentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  department: HrRefSchema,
  body: z.string(),
  attachment_ids: z.array(HrDocumentAttachmentSchema),
  expiry_date: isoDate.nullable(),
  write_date: z.string(),
}).strict()

export const HrDocumentDetailSchema = HrDocumentSchema

export const HrDepartmentListSchema = z.object({
  items: z.array(HrDepartmentSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrEmployeeListSchema = z.object({
  items: z.array(HrEmployeeSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrDocumentListSchema = z.object({
  items: z.array(HrDocumentSchema),
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
export type HrRef = z.infer<typeof HrRefSchema>
export type HrEmployeeAccess = z.infer<typeof HrEmployeeAccessSchema>
export type HrEmployeeCreate = z.infer<typeof HrEmployeeCreateSchema>
export type HrEmployeePatch = z.infer<typeof HrEmployeePatchSchema>
export type HrAccessGrant = z.infer<typeof HrAccessGrantSchema>
export type HrAccessPatch = z.infer<typeof HrAccessPatchSchema>
export type HrDepartmentCreate = z.infer<typeof HrDepartmentCreateSchema>
export type HrDepartmentPatch = z.infer<typeof HrDepartmentPatchSchema>
export type HrDocumentAttachment = z.infer<typeof HrDocumentAttachmentSchema>
export type HrDocument = z.infer<typeof HrDocumentSchema>
export type HrDocumentDetail = z.infer<typeof HrDocumentDetailSchema>
export type HrDepartmentList = z.infer<typeof HrDepartmentListSchema>
export type HrEmployeeList = z.infer<typeof HrEmployeeListSchema>
export type HrDocumentList = z.infer<typeof HrDocumentListSchema>
export type HrEmployeeContractPatch = z.infer<typeof HrEmployeeContractPatchSchema>
export type HrEmployeeContract = z.infer<typeof HrEmployeeContractSchema>
export type HrExpiryKind = z.infer<typeof HrExpiryKindSchema>
export type HrExpiringItem = z.infer<typeof HrExpiringItemSchema>
export type HrExpiringList = z.infer<typeof HrExpiringListSchema>
export type HrSaudizationRow = z.infer<typeof HrSaudizationRowSchema>
export type HrSaudization = z.infer<typeof HrSaudizationSchema>
