import { z } from 'zod'

const TimezoneSchema = z.string().min(1).refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}, 'Invalid IANA timezone')
const RevisionSchema = z.number().int().nonnegative()
const WindowSchema = z.object({
  timezone: TimezoneSchema,
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  durationMinutes: z.number().int().min(1).max(1440),
})
export const MaintenancePreferencePatchSchema = WindowSchema.extend({ revision: RevisionSchema }).strict()
export const MaintenancePreferenceSchema = MaintenancePreferencePatchSchema.extend({ id: z.number().int().positive() })
export const MaintenanceReleaseSchema = z.object({
  id: z.number().int().positive(),
  releaseId: z.string().min(1),
  deadlineAt: z.iso.datetime(),
  estimatedSeconds: z.number().int().positive(),
  scope: z.enum(['tenant', 'ai_service', 'infrastructure']),
  status: z.enum(['supported', 'withdrawn']),
  urgency: z.enum(['normal', 'security']),
  policy: z.string().min(1),
}).strict()
export const MaintenanceBookingSchema = z.object({
  id: z.number().int().positive(),
  releaseId: z.number().int().positive(),
  scheduledAt: z.iso.datetime(),
  timezone: TimezoneSchema,
  durationMinutes: z.number().int().min(1).max(1440),
  status: z.enum(['scheduled', 'cancelled', 'running', 'complete', 'failed']),
  revision: RevisionSchema,
}).strict()
const BookingTimeSchema = z.object({
  releaseId: z.number().int().positive(),
  localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  timezone: TimezoneSchema,
  durationMinutes: z.number().int().min(1).max(1440),
}).strict()
export const MaintenanceBookingInputSchema = z.union([
  BookingTimeSchema,
  z.object({ releaseId: z.number().int().positive(), usePreference: z.literal(true), preferenceRevision: RevisionSchema }).strict(),
])
export const MaintenanceBookingPatchSchema = z.union([
  BookingTimeSchema.omit({ releaseId: true }).extend({ revision: RevisionSchema }).strict(),
  z.object({ status: z.literal('cancelled'), revision: RevisionSchema }).strict(),
])
export const MaintenanceSnapshotSchema = z.object({
  preference: MaintenancePreferenceSchema.nullable(),
  releases: z.object({ items: z.array(MaintenanceReleaseSchema), total: z.number().int().nonnegative() }).strict(),
  bookings: z.object({ items: z.array(MaintenanceBookingSchema), total: z.number().int().nonnegative() }).strict(),
}).strict()
export type MaintenancePreference = z.infer<typeof MaintenancePreferenceSchema>
export type MaintenancePreferencePatch = z.infer<typeof MaintenancePreferencePatchSchema>
export type MaintenanceRelease = z.infer<typeof MaintenanceReleaseSchema>
export type MaintenanceBooking = z.infer<typeof MaintenanceBookingSchema>
export type MaintenanceBookingInput = z.infer<typeof MaintenanceBookingInputSchema>
export type MaintenanceBookingPatch = z.infer<typeof MaintenanceBookingPatchSchema>
export type MaintenanceSnapshot = z.infer<typeof MaintenanceSnapshotSchema>
