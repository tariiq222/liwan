import { z } from 'zod'

/** The first-run wizard's steps in their fixed order, as `liwan.setup.step` keeps them. */
export const SETUP_STEP_KEYS = ['company', 'sector', 'channels', 'team', 'contacts'] as const
export const SetupStepKeySchema = z.enum(SETUP_STEP_KEYS)
export type SetupStepKey = z.infer<typeof SetupStepKeySchema>

export const SetupOutcomeSchema = z.enum(['done', 'skipped'])
export type SetupOutcome = z.infer<typeof SetupOutcomeSchema>

/** One step; `outcome` is null while it is open, and who recorded it and when are null with it. */
export const SetupStepSchema = z.object({
  key: SetupStepKeySchema,
  outcome: SetupOutcomeSchema.nullable(),
  recorded_by: z.object({ id: z.number().int(), name: z.string() }).strict().nullable(),
  recorded_at: z.string().nullable(),
}).strict()
export type SetupStep = z.infer<typeof SetupStepSchema>

/** `GET` and `PUT /api/v1/setup/progress`. `complete` means every step has an outcome, skipped counting as handled. */
export const SetupProgressSchema = z.object({
  steps: z.array(SetupStepSchema).length(SETUP_STEP_KEYS.length),
  closed_at: z.string().nullable(),
  complete: z.boolean(),
}).strict()
export type SetupProgress = z.infer<typeof SetupProgressSchema>

/** Body of `PUT /api/v1/setup/progress`: set a step's outcome (`null` clears it), or close or reopen the wizard. */
export const SetupProgressChangeSchema = z.union([
  z.object({ step: SetupStepKeySchema, outcome: SetupOutcomeSchema.nullable() }).strict(),
  z.object({ closed: z.boolean() }).strict(),
])
export type SetupProgressChange = z.infer<typeof SetupProgressChangeSchema>
