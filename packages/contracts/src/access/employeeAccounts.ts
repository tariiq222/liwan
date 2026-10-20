import { z } from 'zod'
import { AssignmentListSchema, PasswordInputSchema } from './access'

// The employee-account bridge (webvue_access_hr): present only when the HR application is installed.
export const EmployeeAccountCandidateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  department: z.object({ id: z.number().int().positive(), name: z.string() }).strict().nullable(),
  work_email: z.string().email().nullable(),
  active: z.boolean(),
  user_id: z.number().int().positive().nullable(),
  access_active: z.boolean().nullable(),
}).strict()
export type EmployeeAccountCandidate = z.infer<typeof EmployeeAccountCandidateSchema>
export const EmployeeAccountCandidateListSchema = z.object({ items: z.array(EmployeeAccountCandidateSchema), total: z.number().int().nonnegative() }).strict()
export type EmployeeAccountCandidateList = z.infer<typeof EmployeeAccountCandidateListSchema>

export const EmployeeAccountInputSchema = z.object({
  employee_id: z.number().int().positive(),
  password: PasswordInputSchema,
  assignments: AssignmentListSchema,
}).strict()
export type EmployeeAccountInput = z.infer<typeof EmployeeAccountInputSchema>
