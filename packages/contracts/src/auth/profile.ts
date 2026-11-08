import { z } from 'zod'

/** The two account fields a person owns: the language mail and notifications use, and the time zone they read. */
export const ProfileLangSchema = z.string().min(2).max(16)
export const ProfileTimezoneSchema = z.string().max(64)
export const ProfilePatchSchema = z.object({
  lang: ProfileLangSchema.optional(),
  tz: ProfileTimezoneSchema.optional(),
}).strict().refine(value => value.lang !== undefined || value.tz !== undefined, {
  message: 'lang or tz is required',
})
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>

/** One remembered browser. The token and its hash never appear here. */
export const RememberedDeviceSchema = z.object({
  id: z.number().int().positive(),
  label: z.string(),
  issued_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  last_used_at: z.string().nullable(),
}).strict()
export type RememberedDevice = z.infer<typeof RememberedDeviceSchema>

export const RememberedDeviceListSchema = z.object({
  items: z.array(RememberedDeviceSchema),
  total: z.number().int().nonnegative(),
}).strict()
export type RememberedDeviceList = z.infer<typeof RememberedDeviceListSchema>
