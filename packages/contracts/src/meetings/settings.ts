import { z } from 'zod'

const userId = z.number().int().positive()
const httpUrl = z.string().refine(value => {
  if (value === '') return true
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname && !/\s/.test(value)
  } catch {
    return false
  }
}, { message: 'meeting_url must be an HTTP(S) URL' })

export const MeetingSeriesPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  location: z.string().optional(),
  meeting_url: httpUrl.optional(),
  secretary_id: userId.nullable().optional(),
  attendee_ids: z.array(userId).optional(),
}).strict()

export type MeetingSeriesPatch = z.infer<typeof MeetingSeriesPatchSchema>
