import { z } from 'zod'

const VersionSchema = z.string().trim().min(1)
export const MAX_SEAT_PRIORITY = 2_147_483_647
const PrioritySchema = z.number().int().nonnegative().max(MAX_SEAT_PRIORITY)

/** Make an account a full or a read-only seat holder, or set its reopening priority (`0` clears it). */
export const SeatChangeInputSchema = z.object({
  expected_version: VersionSchema,
  read_only: z.boolean().optional(),
  priority: PrioritySchema.optional(),
}).strict().refine(value => value.read_only !== undefined || value.priority !== undefined, { message: 'read_only or priority is required' })
export type SeatChangeInput = z.infer<typeof SeatChangeInputSchema>

/** A branch above `branches.extra_limit` stays active and readable but takes no writes. */
export const BranchSeatSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  read_only: z.boolean(),
  seat_choice: z.enum(['auto', 'customer']),
  restore_priority: PrioritySchema,
}).strict()
export type BranchSeat = z.infer<typeof BranchSeatSchema>

export const BranchSeatListSchema = z.object({
  items: z.array(BranchSeatSchema),
  total: z.number().int().nonnegative(),
  /** `null` when the subscription has no branch limit. */
  limit: z.number().int().nonnegative().nullable(),
  read_only: z.number().int().nonnegative(),
}).strict()
export type BranchSeatList = z.infer<typeof BranchSeatListSchema>

export const BranchSeatChangeInputSchema = z.object({
  read_only: z.boolean().optional(),
  priority: PrioritySchema.optional(),
}).strict().refine(value => value.read_only !== undefined || value.priority !== undefined, { message: 'read_only or priority is required' })
export type BranchSeatChangeInput = z.infer<typeof BranchSeatChangeInputSchema>
