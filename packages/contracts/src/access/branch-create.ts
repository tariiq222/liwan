import { z } from 'zod'

export const BranchCreateInputSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict()
export const BranchCreatedSchema = z.object({ id: z.number().int().positive(), name: z.string().min(1) }).strict()

export type BranchCreateInput = z.infer<typeof BranchCreateInputSchema>
export type BranchCreated = z.infer<typeof BranchCreatedSchema>
