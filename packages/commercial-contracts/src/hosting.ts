import { z } from 'zod'

/** The tenant's hosting lane; one schema for the tenant record and the vendor client list. */
export const hostingModelSchema = z.enum(['shared_managed', 'dedicated_managed', 'customer_hosted'])
export type HostingModel = z.infer<typeof hostingModelSchema>
