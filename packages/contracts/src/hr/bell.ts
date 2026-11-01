import { z } from 'zod'

export const HrLeaveBellKindSchema = z.enum(['hr.leave_approved', 'hr.leave_refused'])

/** A leave-decision bell row as the notification list sends it; `title` is the leave's date range, never prose. */
export const HrLeaveBellRowSchema = z.looseObject({
  id: z.number().int().positive(),
  kind: HrLeaveBellKindSchema,
  leave_id: z.number().int().positive(),
  title: z.string(),
  created_at: z.string(),
  is_read: z.boolean(),
})

export const HrOnboardingStepBellKindSchema = z.literal('hr.onboarding_step')

/** An onboarding-step bell row: it points at the plan run and its `title` is the step's summary. */
export const HrOnboardingStepBellRowSchema = z.looseObject({
  id: z.number().int().positive(),
  kind: HrOnboardingStepBellKindSchema,
  run_id: z.number().int().positive(),
  title: z.string(),
  created_at: z.string(),
  is_read: z.boolean(),
})

export const HrWarningBellKindSchema = z.literal('hr.warning_issued')

/** A warning bell row: it points at the warning and its `title` is the warning type's name, never the reason. */
export const HrWarningBellRowSchema = z.looseObject({
  id: z.number().int().positive(),
  kind: HrWarningBellKindSchema,
  warning_id: z.number().int().positive(),
  title: z.string(),
  created_at: z.string(),
  is_read: z.boolean(),
})

export type HrLeaveBellKind = z.infer<typeof HrLeaveBellKindSchema>
export type HrLeaveBellRow = z.infer<typeof HrLeaveBellRowSchema>
export type HrOnboardingStepBellRow = z.infer<typeof HrOnboardingStepBellRowSchema>
export type HrWarningBellRow = z.infer<typeof HrWarningBellRowSchema>
