import { z } from 'zod'
import { HrRefSchema } from './ref'

/** Administrative warnings (`/api/v1/hr/warnings`, `/warning-types`, `/warnings/settings`). */
const isoDate = z.iso.date()
const recordId = z.number().int().positive()
const revision = z.number().int().positive()
const trimmed = z.string().trim().min(1)

export const HR_WARNING_STATES = ['draft', 'issued', 'acknowledged', 'contested', 'withdrawn'] as const
export const HrWarningStateSchema = z.enum(HR_WARNING_STATES)
/** How the employee answers a warning: required (pending until answered), optional, or off. */
export const HrWarningAcknowledgementSchema = z.enum(['required', 'optional', 'off'])
/** Who may issue: HR alone, or HR and the employee's direct manager. */
export const HrWarningIssuedBySchema = z.enum(['hr_only', 'manager_and_hr'])

export const HrWarningTypeSchema = z.object({
  id: recordId,
  name: z.string(),
  /** The escalation rank: a higher number is a more serious warning. */
  severity: z.number().int().positive(),
  active: z.boolean(),
  revision,
}).strict()

export const HrWarningTypeListSchema = z.object({
  items: z.array(HrWarningTypeSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrWarningTypeCreateSchema = z.object({
  name: trimmed.max(100),
  severity: z.number().int().min(1).max(1000),
}).strict()

export const HrWarningTypePatchSchema = z.object({
  name: trimmed.max(100).optional(),
  severity: z.number().int().min(1).max(1000).optional(),
  active: z.boolean().optional(),
  revision,
}).strict().refine(value => Object.keys(value).length > 1, { message: 'At least one field is required' })

export const HrWarningSchema = z.object({
  id: recordId,
  employee: HrRefSchema,
  type: z.object({ id: recordId, name: z.string(), severity: z.number().int().positive() }).strict(),
  date_issued: isoDate,
  reason: z.string(),
  corrective_action: z.string().nullable(),
  state: HrWarningStateSchema,
  /** The company's answer policy at the moment of issue. */
  acknowledgement: HrWarningAcknowledgementSchema,
  /** Issued, answer required and not yet given. */
  ack_pending: z.boolean(),
  issued_by: HrRefSchema.nullable(),
  issued_at: z.iso.datetime().nullable(),
  acknowledged_at: z.iso.datetime().nullable(),
  contested_at: z.iso.datetime().nullable(),
  contest_note: z.string().nullable(),
  withdrawn_by: HrRefSchema.nullable(),
  withdrawn_at: z.iso.datetime().nullable(),
  withdraw_reason: z.string().nullable(),
  revision,
}).strict()

export const HrWarningListSchema = z.object({
  items: z.array(HrWarningSchema),
  total: z.number().int().nonnegative(),
}).strict()

// Query of the list routes: `employee_id`, `type_id`, `state`, `limit`, `offset`.
export const HrWarningCreateSchema = z.object({
  employee_id: recordId,
  type_id: recordId,
  date_issued: isoDate.optional(),
  reason: trimmed,
  corrective_action: z.string().optional(),
}).strict()

/** Issue and acknowledge: the revision the caller read. */
export const HrWarningRevisionSchema = z.object({ revision }).strict()
export const HrWarningWithdrawSchema = z.object({ revision, reason: trimmed }).strict()
export const HrWarningContestSchema = z.object({ revision, note: trimmed }).strict()

export const HrWarningSettingsSchema = z.object({
  warnings_issued_by: HrWarningIssuedBySchema,
  warnings_employee_acknowledgement: HrWarningAcknowledgementSchema,
  /** How many months back a warning still counts toward escalation. */
  warnings_escalation_window_months: z.number().int().min(1).max(60),
  /** 0 until the company saves its first policy. */
  revision: z.number().int().nonnegative(),
}).strict()
export const HrWarningSettingsPatchSchema = HrWarningSettingsSchema

/** The escalation figure shown to issuers: counted warnings inside the window and the highest severity among them. */
export const HrWarningStandingSchema = z.object({
  employee_id: recordId,
  window_months: z.number().int().positive(),
  active_count: z.number().int().nonnegative(),
  highest_severity: z.number().int().positive().nullable(),
}).strict()

export type HrWarningState = z.infer<typeof HrWarningStateSchema>
export type HrWarningAcknowledgement = z.infer<typeof HrWarningAcknowledgementSchema>
export type HrWarningIssuedBy = z.infer<typeof HrWarningIssuedBySchema>
export type HrWarningType = z.infer<typeof HrWarningTypeSchema>
export type HrWarningTypeList = z.infer<typeof HrWarningTypeListSchema>
export type HrWarningTypeCreate = z.infer<typeof HrWarningTypeCreateSchema>
export type HrWarningTypePatch = z.infer<typeof HrWarningTypePatchSchema>
export type HrWarning = z.infer<typeof HrWarningSchema>
export type HrWarningList = z.infer<typeof HrWarningListSchema>
export type HrWarningCreate = z.infer<typeof HrWarningCreateSchema>
export type HrWarningRevision = z.infer<typeof HrWarningRevisionSchema>
export type HrWarningWithdraw = z.infer<typeof HrWarningWithdrawSchema>
export type HrWarningContest = z.infer<typeof HrWarningContestSchema>
export type HrWarningSettings = z.infer<typeof HrWarningSettingsSchema>
export type HrWarningSettingsPatch = z.infer<typeof HrWarningSettingsPatchSchema>
export type HrWarningStanding = z.infer<typeof HrWarningStandingSchema>
