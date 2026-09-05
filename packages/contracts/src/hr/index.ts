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
}).strict()

export const HrEmployeeCreateSchema = z.object({
  name: nonEmptyTrimmedName,
  work_email: optionalEmail,
  work_phone: z.string().optional(),
  job_title: z.string().optional(),
  department_id: relationId,
  parent_id: relationId,
}).strict()

export const HrEmployeePatchSchema = z.object({
  name: nonEmptyTrimmedName.optional(),
  work_email: optionalEmail,
  work_phone: z.string().optional(),
  job_title: z.string().optional(),
  department_id: relationId,
  parent_id: relationId,
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
}).strict()

export const HrDepartmentPatchSchema = z.object({
  name: nonEmptyTrimmedName.optional(),
  parent_id: relationId,
}).strict().refine(requirePatchField, { message: 'At least one field is required' })

export const HrDocumentAttachmentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  mimetype: z.string(),
  file_size: z.number(),
}).strict()

export const HrDocumentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  department: HrRefSchema,
  body: z.string(),
  attachment_ids: z.array(HrDocumentAttachmentSchema),
  write_date: z.string(),
}).strict()

export const HrDocumentDetailSchema = HrDocumentSchema

export const HrDepartmentListSchema = z.object({
  items: z.array(HrDepartmentSchema),
  total: z.number().int(),
}).strict()

export const HrEmployeeListSchema = z.object({
  items: z.array(HrEmployeeSchema),
  total: z.number().int(),
}).strict()

export const HrDocumentListSchema = z.object({
  items: z.array(HrDocumentSchema),
  total: z.number().int(),
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
