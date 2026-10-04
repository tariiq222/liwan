import { z } from 'zod'

// Existing managed runtime/readback numeric ceiling; not a commercial default.
export const PACKAGE_LIMIT_MAX = 1000000000
export const packageLimitsSchema = z.record(z.string().regex(/^(?:[a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*$/), z.number().int().nonnegative().max(PACKAGE_LIMIT_MAX).nullable())
export const packageInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(2000),
  catalog_version: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
  catalog_tier: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/), limits: packageLimitsSchema,
})
export const packageActionSchema = z.strictObject({ revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), reason: z.string().trim().min(3).max(1000) })
export const packageEditSchema = packageInputSchema.extend({ revision: packageActionSchema.shape.revision })
export const packageCloneSchema = z.strictObject({ reason: packageActionSchema.shape.reason })
export const packageRevisionSchema = packageInputSchema.extend({
  id: z.uuid(), package_id: z.uuid(), version: z.number().int().positive(), revision: packageActionSchema.shape.revision,
  status: z.enum(['draft','validated','published']), available: z.boolean(), source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  modules: z.array(z.string()), features: z.array(z.string()), customer_count: z.number().int().nonnegative(),
  created_at: z.iso.datetime(), published_at: z.iso.datetime().nullable(),
})
export type PackageInput = z.infer<typeof packageInputSchema>
export type PackageRevision = z.infer<typeof packageRevisionSchema>
export const packageListSchema = z.strictObject({ items: z.array(packageRevisionSchema), total: z.number().int().nonnegative() })
