import { z } from 'zod'

export const ProjectCharterCatalogResourceSchema = z.enum(['types', 'owning-units'])

export const ProjectCharterReferenceSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  sequence: z.number().int(),
  active: z.boolean(),
}).strict()

export const ProjectCharterReferenceListSchema = z.object({
  items: z.array(ProjectCharterReferenceSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const ProjectCharterReferenceCreateSchema = z.object({
  name: z.string().min(1),
  sequence: z.number().int().optional(),
}).strict()

export const ProjectCharterReferencePatchSchema = z.object({
  name: z.string().min(1).optional(),
  sequence: z.number().int().optional(),
  active: z.boolean().optional(),
}).strict()

export const ProjectCharterReferenceDeletedSchema = z.object({
  deleted: z.literal(true),
}).strict()

export type ProjectCharterCatalogResource = z.infer<typeof ProjectCharterCatalogResourceSchema>
export type ProjectCharterReference = z.infer<typeof ProjectCharterReferenceSchema>
export type ProjectCharterReferenceList = z.infer<typeof ProjectCharterReferenceListSchema>
export type ProjectCharterReferenceCreate = z.infer<typeof ProjectCharterReferenceCreateSchema>
export type ProjectCharterReferencePatch = z.infer<typeof ProjectCharterReferencePatchSchema>
export type ProjectCharterReferenceDeleted = z.infer<typeof ProjectCharterReferenceDeletedSchema>
