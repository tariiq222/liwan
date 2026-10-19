import { z } from 'zod'
import { HrRefSchema } from './ref'

/** The recruitment area (`/api/v1/hr/recruitment`), over stock hr_recruitment. */
const isoDate = z.iso.date()
const relationId = z.number().int().positive().nullable().optional()
const nonEmptyTrimmedName = z.string().trim().min(1)
const optionalEmail = z.string().email().or(z.literal('')).optional()
const priority = z.enum(['0', '1', '2', '3'])
const requirePatchField = (value: object) => Object.keys(value).length > 0

export const HrApplicantStatusSchema = z.enum(['ongoing', 'hired', 'refused', 'archived'])

export const HrRecruitmentJobSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  department: HrRefSchema.nullable(),
  no_of_recruitment: z.number().int().nonnegative(),
  // WebVue counts the ongoing applicants of the company; the stock field is group-gated.
  application_count: z.number().int().nonnegative(),
  description: z.string(),
  active: z.boolean(),
}).strict()

export const HrRecruitmentJobListSchema = z.object({
  items: z.array(HrRecruitmentJobSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrRecruitmentJobCreateSchema = z.object({
  name: nonEmptyTrimmedName,
  department_id: relationId,
  no_of_recruitment: z.number().int().nonnegative().optional(),
  description: z.string().optional(),
}).strict()

export const HrRecruitmentJobPatchSchema = z.object({
  name: nonEmptyTrimmedName.optional(),
  department_id: relationId,
  no_of_recruitment: z.number().int().nonnegative().optional(),
  description: z.string().optional(),
  active: z.boolean().optional(),
}).strict().refine(requirePatchField, { message: 'At least one field is required' })

export const HrRecruitmentStageSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  sequence: z.number().int(),
  hired_stage: z.boolean(),
  fold: z.boolean(),
}).strict()

export const HrRecruitmentStageListSchema = z.object({
  items: z.array(HrRecruitmentStageSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrRecruitmentRefuseReasonListSchema = z.object({
  items: z.array(HrRefSchema),
  total: z.number().int().nonnegative(),
}).strict()

// No salary, UTM, attachment, property, note or interviewer key exists here by design.
export const HrApplicantSchema = z.object({
  id: z.number().int().positive(),
  partner_name: z.string(),
  email_from: z.string(),
  partner_phone: z.string(),
  job: HrRefSchema.nullable(),
  department: HrRefSchema.nullable(),
  stage: HrRefSchema.nullable(),
  status: HrApplicantStatusSchema,
  priority,
  availability: isoDate.nullable(),
  refuse_reason: HrRefSchema.nullable(),
  employee: HrRefSchema.nullable(),
  applied_on: z.iso.datetime({ offset: true }),
  active: z.boolean(),
}).strict()

export const HrApplicantListSchema = z.object({
  items: z.array(HrApplicantSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrApplicantCreateSchema = z.object({
  partner_name: nonEmptyTrimmedName,
  job_id: z.number().int().positive(),
  email_from: optionalEmail,
  partner_phone: z.string().optional(),
  availability: isoDate.optional(),
}).strict()

export const HrApplicantPatchSchema = z.object({
  partner_name: nonEmptyTrimmedName.optional(),
  email_from: optionalEmail,
  partner_phone: z.string().optional(),
  availability: isoDate.nullable().optional(),
  stage_id: relationId,
  priority: priority.optional(),
}).strict().refine(requirePatchField, { message: 'At least one field is required' })

export const HrApplicantRefuseSchema = z.object({
  refuse_reason_id: z.number().int().positive(),
}).strict()

export const HrApplicantHireResultSchema = z.object({
  applicant: HrApplicantSchema,
  employee: HrRefSchema,
}).strict()

export type HrRecruitmentJob = z.infer<typeof HrRecruitmentJobSchema>
export type HrRecruitmentJobList = z.infer<typeof HrRecruitmentJobListSchema>
export type HrRecruitmentJobCreate = z.infer<typeof HrRecruitmentJobCreateSchema>
export type HrRecruitmentJobPatch = z.infer<typeof HrRecruitmentJobPatchSchema>
export type HrRecruitmentStage = z.infer<typeof HrRecruitmentStageSchema>
export type HrRecruitmentStageList = z.infer<typeof HrRecruitmentStageListSchema>
export type HrRecruitmentRefuseReasonList = z.infer<typeof HrRecruitmentRefuseReasonListSchema>
export type HrApplicant = z.infer<typeof HrApplicantSchema>
export type HrApplicantList = z.infer<typeof HrApplicantListSchema>
export type HrApplicantCreate = z.infer<typeof HrApplicantCreateSchema>
export type HrApplicantPatch = z.infer<typeof HrApplicantPatchSchema>
export type HrApplicantRefuse = z.infer<typeof HrApplicantRefuseSchema>
export type HrApplicantHireResult = z.infer<typeof HrApplicantHireResultSchema>
export type HrApplicantStatus = z.infer<typeof HrApplicantStatusSchema>
