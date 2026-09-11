import { z } from 'zod'

export const BrandingSchema = z.object({
  name: z.string().min(1),
  logo_url: z.string().min(1),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  font: z.string().min(1),
})
export type Branding = z.infer<typeof BrandingSchema>

export const BrandingPatchSchema = z.object({
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
}).strict().refine(value => value.primary_color !== undefined || value.secondary_color !== undefined, 'A color is required')
export type BrandingPatch = z.infer<typeof BrandingPatchSchema>
