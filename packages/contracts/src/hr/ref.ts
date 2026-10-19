import { z } from 'zod'

/**
 * The reference shape every HR area serializer uses for a related record
 * (`{id, name}`). It lives in its own module, not in the namespace barrel: the area
 * modules below import it while `index.ts` re-exports them, and a barrel import would
 * be a cycle that leaves the schema undefined at module-evaluation time.
 */
export const HrRefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

export type HrRef = z.infer<typeof HrRefSchema>
