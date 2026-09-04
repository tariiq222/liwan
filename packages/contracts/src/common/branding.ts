import { z } from 'zod'

export const BrandingSchema = z.object({
  name: z.string().min(1),
  logo_url: z.string().min(1),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  font: z.string().min(1),
})
export type Branding = z.infer<typeof BrandingSchema>
