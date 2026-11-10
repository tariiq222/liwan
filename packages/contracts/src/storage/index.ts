import { z } from 'zod'

const CountSchema = z.number().int().nonnegative()

const StorageItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  size_bytes: CountSchema,
  created_at: z.iso.datetime().nullable(),
  blocked: z.boolean(),
  record: z.object({ kind: z.string().min(1), id: z.number().int().positive() }).strict().nullable(),
}).strict()

/** Visible files from the active company, plus tenant-wide usage when the active company is headquarters. */
export const StorageInventorySchema = z.object({
  items: z.array(StorageItemSchema).max(100),
  total: CountSchema,
  summary: z.object({
    limit_mb: CountSchema.nullable(),
    used_bytes: CountSchema,
    blocked_bytes: CountSchema,
  }).strict().nullable(),
}).strict()

export type StorageInventory = z.infer<typeof StorageInventorySchema>
