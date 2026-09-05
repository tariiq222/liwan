import { z } from 'zod'

export const BrandingSchema = z.object({
  name: z.string().min(1),
  logo_url: z.string().min(1),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  font: z.string().min(1),
})
export type Branding = z.infer<typeof BrandingSchema>

const rawBase64Schema = z.string().min(1).refine(
  (value) => /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
  { message: 'logo must be raw base64' },
)

export const BrandingPatchSchema = z.object({
  name: z.string().trim().min(1).max(100),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logo: rawBase64Schema.refine((value) => !value.startsWith('data:'), { message: 'logo must not include a data URI prefix' }),
}).partial().strict().refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })
export type BrandingPatch = z.infer<typeof BrandingPatchSchema>
