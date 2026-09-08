import { z } from 'zod'
import { TaskStateSchema } from './state'

function validCalendarDate(value: string): boolean {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  const candidate = new Date(Date.UTC(year, month - 1, day))
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day
}

export const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validCalendarDate, 'must be a valid calendar date')
export const ScheduleDateSchema = CalendarDateSchema.nullable()

export const ScheduleTaskSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  start: ScheduleDateSchema,
  end: ScheduleDateSchema,
  state: TaskStateSchema,
  dependency_ids: z.array(z.number().int().positive()),
  milestone_id: z.number().int().positive().nullable(),
}).strict().superRefine((task, ctx) => {
  if (task.start && task.end && task.start > task.end) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'end must be on or after start' })
  }
})

export const ScheduleMilestoneSchema = z.object({
  id: z.number().int().positive(), name: z.string(), start_date: ScheduleDateSchema.default(null), deadline: ScheduleDateSchema,
}).strict()

export const ProjectScheduleSchema = z.object({
  project_id: z.number().int().positive(),
  tasks: z.array(ScheduleTaskSchema),
  milestones: z.array(ScheduleMilestoneSchema),
  can_manage: z.boolean(),
  total: z.number().int().nonnegative(),
}).strict()

export const ScheduleTaskPatchSchema = z.object({
  start: ScheduleDateSchema,
  end: ScheduleDateSchema,
}).strict().superRefine((value, ctx) => {
  if (value.start && value.end && value.start > value.end) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'end must be on or after start' })
  }
  if ((value.start === null) !== (value.end === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'start and end must be set together' })
  }
})

export type ScheduleTask = z.infer<typeof ScheduleTaskSchema>
export type ScheduleMilestone = z.infer<typeof ScheduleMilestoneSchema>
export type ProjectSchedule = z.infer<typeof ProjectScheduleSchema>
export type ScheduleTaskPatch = z.infer<typeof ScheduleTaskPatchSchema>
