import { z } from 'zod'
import { bundleRevisionSchema, catalogReleaseSchema, listEnvelopeSchema, planRevisionSchema, quoteRequestSchema, quoteSchema, pricingPolicySchema } from './commercial/schemas.js'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
export const commercialIssueSchema = z.strictObject({ code: z.string(), field: z.string().optional() })
const viewExtras = {
  content_digest: digest, validated_digest: digest.nullable(), customer_count: z.number().int().min(0),
  created_at: z.string(), published_at: z.string().nullable(), issues: z.array(commercialIssueSchema),
}
export const bundleViewSchema = bundleRevisionSchema.extend(viewExtras)
export const planViewSchema = planRevisionSchema.extend(viewExtras)
export const catalogReleaseViewSchema = catalogReleaseSchema.extend({ created_at: z.string() })
export const catalogReleaseCreateSchema = z.strictObject({ catalog_version: z.string().min(1).max(100), reason: z.string().trim().min(3).max(1000) })
export const quotePreviewRequestSchema = quoteRequestSchema.extend({ customer_id: z.string().min(1).max(100).optional() })
export const bundleListSchema = listEnvelopeSchema(bundleViewSchema)
export const planListSchema = listEnvelopeSchema(planViewSchema)
export const catalogReleaseListSchema = listEnvelopeSchema(catalogReleaseViewSchema)
export const pricingPolicyViewSchema = pricingPolicySchema
export const quoteViewSchema = quoteSchema
export const bundleRevisionCloneSchema = z.strictObject({ edit_revision: z.number().int().positive(), reason: z.string().trim().min(3).max(1000) })

export type CommercialIssue = z.infer<typeof commercialIssueSchema>
export type BundleView = z.infer<typeof bundleViewSchema>
export type PlanView = z.infer<typeof planViewSchema>
export type CatalogReleaseView = z.infer<typeof catalogReleaseViewSchema>
export type QuotePreviewRequest = z.infer<typeof quotePreviewRequestSchema>
