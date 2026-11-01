import { z } from 'zod'
import { HrRefSchema } from './ref'

/** Medical insurance (`/api/v1/hr/insurance/*`): providers, plans, enrollments, dependents, own card, policy and summary. */
const isoDate = z.iso.date()
const recordId = z.number().int().positive()
const revision = z.number().int().positive()
const trimmed = z.string().trim().min(1)
const amount = z.number().min(0).max(1_000_000_000)

export const HR_INSURANCE_PLAN_STATES = ['active', 'expired', 'archived'] as const
export const HrInsurancePlanStateSchema = z.enum(HR_INSURANCE_PLAN_STATES)
/** `lapsed` is derived: an active enrollment whose end date has passed. */
export const HR_INSURANCE_ENROLLMENT_STATES = ['active', 'lapsed', 'ended', 'cancelled'] as const
export const HrInsuranceEnrollmentStateSchema = z.enum(HR_INSURANCE_ENROLLMENT_STATES)
export const HR_INSURANCE_RELATIONS = ['spouse', 'child', 'parent', 'other'] as const
export const HrInsuranceRelationSchema = z.enum(HR_INSURANCE_RELATIONS)
/** What an employee sees of their own coverage: the enrollment and its dependents, or the enrollment alone. */
export const HrInsuranceVisibilitySchema = z.enum(['own_enrollment_and_dependents', 'own_enrollment_only'])

export const HrInsuranceProviderSchema = z.object({
  id: recordId,
  name: z.string(),
  active: z.boolean(),
  revision,
}).strict()

export const HrInsuranceProviderListSchema = z.object({
  items: z.array(HrInsuranceProviderSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrInsuranceProviderCreateSchema = z.object({ name: trimmed.max(100) }).strict()

export const HrInsuranceProviderPatchSchema = z.object({
  name: trimmed.max(100).optional(),
  active: z.boolean().optional(),
  revision,
}).strict().refine(value => Object.keys(value).length > 1, { message: 'At least one field is required' })

export const HrInsurancePlanSchema = z.object({
  id: recordId,
  provider: HrRefSchema,
  name: z.string(),
  /** The class or tier label the insurer sells the plan under. */
  tier: z.string().nullable(),
  policy_number: z.string().nullable(),
  valid_from: isoDate,
  valid_to: isoDate,
  /** Per member and per year; null when the company records none. */
  annual_premium: z.number().nullable(),
  /** Derived from the dates and the archive flag, never stored. */
  state: HrInsurancePlanStateSchema,
  /** Days to `valid_to`, negative once expired; null for an archived plan. */
  expires_in_days: z.number().int().nullable(),
  active: z.boolean(),
  revision,
}).strict()

export const HrInsurancePlanListSchema = z.object({
  items: z.array(HrInsurancePlanSchema),
  total: z.number().int().nonnegative(),
}).strict()

// Query of the plan list: `provider_id`, `state`, `limit`, `offset`; archived plans only with `state=archived`.
export const HrInsurancePlanCreateSchema = z.object({
  provider_id: recordId,
  name: trimmed.max(100),
  tier: z.string().trim().max(60).optional(),
  policy_number: z.string().trim().max(60).optional(),
  valid_from: isoDate,
  valid_to: isoDate,
  annual_premium: amount.optional(),
}).strict().refine(value => value.valid_to >= value.valid_from, { message: 'valid_to cannot be before valid_from', path: ['valid_to'] })

export const HrInsurancePlanPatchSchema = z.object({
  name: trimmed.max(100).optional(),
  tier: z.string().trim().max(60).optional(),
  policy_number: z.string().trim().max(60).optional(),
  valid_from: isoDate.optional(),
  valid_to: isoDate.optional(),
  annual_premium: amount.optional(),
  active: z.boolean().optional(),
  revision,
}).strict().refine(value => Object.keys(value).length > 1, { message: 'At least one field is required' })

/** The plan inside an employee's own card: no policy number and no premium. */
export const HrInsurancePlanRefSchema = z.object({
  id: recordId,
  provider: HrRefSchema,
  name: z.string(),
  tier: z.string().nullable(),
  valid_from: isoDate,
  valid_to: isoDate,
}).strict()

export const HrInsuranceDependentSchema = z.object({
  id: recordId,
  enrollment_id: recordId,
  name: z.string(),
  relation: HrInsuranceRelationSchema,
  birth_date: isoDate.nullable(),
  /** `******1234`: the last four characters only. */
  national_id_masked: z.string().nullable(),
  /** The whole number, only for callers who manage insurance. */
  national_id: z.string().nullable(),
  date_from: isoDate,
  date_to: isoDate.nullable(),
  state: z.enum(['active', 'ended', 'cancelled']),
  revision,
}).strict()

const enrollmentCore = {
  id: recordId,
  employee: HrRefSchema,
  member_number: z.string().nullable(),
  date_from: isoDate,
  /** Empty while the enrollment runs to the end of its plan; set when it is ended. */
  date_to: isoDate.nullable(),
  /** `date_to`, or the end of the plan while open. */
  date_end: isoDate,
  state: HrInsuranceEnrollmentStateSchema,
  /** Monthly shares, informational: payroll does not read them in this phase. */
  employee_share: z.number().nullable(),
  company_share: z.number().nullable(),
  revision,
}

/** A row of the enrollment list. */
export const HrInsuranceEnrollmentSchema = z.object({
  ...enrollmentCore,
  plan: HrInsurancePlanRefSchema,
  dependents_count: z.number().int().nonnegative(),
}).strict()

/** The record page: the whole plan, the notes and every dependent. */
export const HrInsuranceEnrollmentDetailSchema = z.object({
  ...enrollmentCore,
  plan: HrInsurancePlanSchema,
  dependents_count: z.number().int().nonnegative(),
  notes: z.string().nullable(),
  dependents: z.array(HrInsuranceDependentSchema),
}).strict()

export const HrInsuranceEnrollmentListSchema = z.object({
  items: z.array(HrInsuranceEnrollmentSchema),
  total: z.number().int().nonnegative(),
}).strict()

// Query of the enrollment list: `employee_id`, `plan_id`, `state`, `expiring=true`, `limit`, `offset`.
export const HrInsuranceEnrollmentCreateSchema = z.object({
  employee_id: recordId,
  plan_id: recordId,
  member_number: z.string().trim().max(40).optional(),
  date_from: isoDate,
  /** Leave empty to run to the end of the plan. */
  date_to: isoDate.optional(),
  employee_share: amount.optional(),
  company_share: amount.optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict()

/** Only the shares and the notes change after creation; ending and cancelling are actions. */
export const HrInsuranceEnrollmentPatchSchema = z.object({
  employee_share: amount.optional(),
  company_share: amount.optional(),
  notes: z.string().trim().max(2000).optional(),
  revision,
}).strict().refine(value => Object.keys(value).length > 1, { message: 'At least one field is required' })

/** End (with an optional date, today by default) and cancel (revision alone). */
export const HrInsuranceEndSchema = z.object({ revision, date_end: isoDate.optional() }).strict()
export const HrInsuranceRevisionSchema = z.object({ revision }).strict()

export const HrInsuranceDependentCreateSchema = z.object({
  name: trimmed.max(100),
  relation: HrInsuranceRelationSchema,
  birth_date: isoDate.optional(),
  national_id: z.string().trim().max(20).optional(),
  date_from: isoDate,
  date_to: isoDate.optional(),
}).strict()

export const HrInsuranceDependentPatchSchema = z.object({
  name: trimmed.max(100).optional(),
  relation: HrInsuranceRelationSchema.optional(),
  birth_date: isoDate.optional(),
  national_id: z.string().trim().max(20).optional(),
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  revision,
}).strict().refine(value => Object.keys(value).length > 1, { message: 'At least one field is required' })

/** The employee's own enrollment: no notes, dependents only when the company's policy shows them. */
export const HrInsuranceOwnEnrollmentSchema = z.object({
  ...enrollmentCore,
  plan: HrInsurancePlanRefSchema,
  dependents_visible: z.boolean(),
  dependents: z.array(HrInsuranceDependentSchema),
}).strict()

export const HrInsuranceOwnListSchema = z.object({
  items: z.array(HrInsuranceOwnEnrollmentSchema),
  total: z.number().int().nonnegative(),
}).strict()

const insurancePolicy = {
  insurance_visibility: HrInsuranceVisibilitySchema,
  /** A bell notification reaches the insurance managers when a plan ends within this many days. */
  insurance_expiry_alert_days: z.number().int().min(1).max(365),
  insurance_require_dependent_id: z.boolean(),
  /** 0 until the company saves its first policy. */
  revision: z.number().int().nonnegative(),
}

/** What a PATCH sends: the whole policy and the revision it was read at; the route answers the same shape. */
export const HrInsuranceSettingsSchema = z.object(insurancePolicy).strict()

/** Counts only: no names, no numbers. */
export const HrInsuranceSummarySchema = z.object({
  active_members: z.number().int().nonnegative(),
  active_enrollments: z.number().int().nonnegative(),
  active_dependents: z.number().int().nonnegative(),
  expiring_plans: z.number().int().nonnegative(),
  employees_without_insurance: z.number().int().nonnegative(),
  expiry_alert_days: z.number().int().positive(),
}).strict()

export type HrInsurancePlanState = z.infer<typeof HrInsurancePlanStateSchema>
export type HrInsuranceEnrollmentState = z.infer<typeof HrInsuranceEnrollmentStateSchema>
export type HrInsuranceRelation = z.infer<typeof HrInsuranceRelationSchema>
export type HrInsuranceVisibility = z.infer<typeof HrInsuranceVisibilitySchema>
export type HrInsuranceProvider = z.infer<typeof HrInsuranceProviderSchema>
export type HrInsuranceProviderList = z.infer<typeof HrInsuranceProviderListSchema>
export type HrInsuranceProviderCreate = z.infer<typeof HrInsuranceProviderCreateSchema>
export type HrInsuranceProviderPatch = z.infer<typeof HrInsuranceProviderPatchSchema>
export type HrInsurancePlan = z.infer<typeof HrInsurancePlanSchema>
export type HrInsurancePlanList = z.infer<typeof HrInsurancePlanListSchema>
export type HrInsurancePlanCreate = z.infer<typeof HrInsurancePlanCreateSchema>
export type HrInsurancePlanPatch = z.infer<typeof HrInsurancePlanPatchSchema>
export type HrInsurancePlanRef = z.infer<typeof HrInsurancePlanRefSchema>
export type HrInsuranceDependent = z.infer<typeof HrInsuranceDependentSchema>
export type HrInsuranceEnrollment = z.infer<typeof HrInsuranceEnrollmentSchema>
export type HrInsuranceEnrollmentDetail = z.infer<typeof HrInsuranceEnrollmentDetailSchema>
export type HrInsuranceEnrollmentList = z.infer<typeof HrInsuranceEnrollmentListSchema>
export type HrInsuranceEnrollmentCreate = z.infer<typeof HrInsuranceEnrollmentCreateSchema>
export type HrInsuranceEnrollmentPatch = z.infer<typeof HrInsuranceEnrollmentPatchSchema>
export type HrInsuranceEnd = z.infer<typeof HrInsuranceEndSchema>
export type HrInsuranceRevision = z.infer<typeof HrInsuranceRevisionSchema>
export type HrInsuranceDependentCreate = z.infer<typeof HrInsuranceDependentCreateSchema>
export type HrInsuranceDependentPatch = z.infer<typeof HrInsuranceDependentPatchSchema>
export type HrInsuranceOwnEnrollment = z.infer<typeof HrInsuranceOwnEnrollmentSchema>
export type HrInsuranceOwnList = z.infer<typeof HrInsuranceOwnListSchema>
export type HrInsuranceSettings = z.infer<typeof HrInsuranceSettingsSchema>
export type HrInsuranceSummary = z.infer<typeof HrInsuranceSummarySchema>
