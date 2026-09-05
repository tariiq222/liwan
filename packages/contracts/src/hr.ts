import { z } from 'zod'

const NamedRefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

export const HrDepartmentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  parent_id: z.number().int().positive().nullable(),
  manager: NamedRefSchema.nullable(),
  child_ids: z.array(z.number().int().positive()),
}).strict()

export const HrEmployeeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  job_title: z.string(),
  department: NamedRefSchema.nullable(),
  work_email: z.string(),
  work_phone: z.string(),
  user_id: z.number().int().positive().nullable(),
}).strict()

export const HrDocumentAttachmentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  mimetype: z.string(),
  file_size: z.number(),
}).strict()

export const HrDocumentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  department: NamedRefSchema,
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
export type HrDocumentAttachment = z.infer<typeof HrDocumentAttachmentSchema>
export type HrDocument = z.infer<typeof HrDocumentSchema>
export type HrDocumentDetail = z.infer<typeof HrDocumentDetailSchema>
export type HrDepartmentList = z.infer<typeof HrDepartmentListSchema>
export type HrEmployeeList = z.infer<typeof HrEmployeeListSchema>
export type HrDocumentList = z.infer<typeof HrDocumentListSchema>
