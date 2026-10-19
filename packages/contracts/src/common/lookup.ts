import { z } from 'zod'

/** GET /admin/company/countries, /finance/countries and their `/{id}/states`: the one paged reference list behind every address picker. */
export const LookupListSchema = z.object({
  items: z.array(z.object({ id: z.number().int().positive(), name: z.string(), code: z.string() }).strict()),
  total: z.number().int().min(0),
}).strict()
export type LookupList = z.infer<typeof LookupListSchema>
