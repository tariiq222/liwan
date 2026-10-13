import { z } from 'zod'

// The person shape of GET /api/v1/people: ids are res.users ids.
export const PersonRefSchema = z.object({ id: z.number().int(), name: z.string(), user_id: z.number().int() }).strict()
export type PersonRef = z.infer<typeof PersonRefSchema>
