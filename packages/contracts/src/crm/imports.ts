import { z } from 'zod'

const NAME_MAX = 200

const RefSchema = z.strictObject({ id: z.number().int(), name: z.string() })
const IsoDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
const ColumnSchema = z.string().trim().min(1).max(NAME_MAX)

// Header names of the uploaded file that feed each customer field; name and phone are required.
export const CrmImportColumnsSchema = z.strictObject({
  name: ColumnSchema,
  phone: ColumnSchema,
  email: ColumnSchema.nullable().optional(),
  notes: ColumnSchema.nullable().optional(),
  package: ColumnSchema.nullable().optional(),
})

export const CrmImportMappingSchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  columns: z.strictObject({
    name: z.string(),
    phone: z.string(),
    email: z.string().nullable(),
    notes: z.string().nullable(),
    package: z.string().nullable(),
  }),
})

export const CrmImportMappingListSchema = z.strictObject({
  items: z.array(CrmImportMappingSchema),
  total: z.number().int().min(0),
})

export const CrmImportMappingCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(NAME_MAX),
  columns: CrmImportColumnsSchema,
})

export const CrmImportFileSchema = z.strictObject({
  file_name: z.string().trim().min(1).max(NAME_MAX),
  content_base64: z.string(),
})

// The header names a file offers for mapping, and how many data rows it holds.
export const CrmImportFileInfoSchema = z.strictObject({
  columns: z.array(z.string()),
  rows: z.number().int().min(0),
})

// Send `mapping` or the id of a saved `mapping_profile`, not both. `source_id` is required and the
// agent (`user_id`) only while distribution is "on import"; the preview checks both like the import.
export const CrmImportRequestSchema = z
  .strictObject({
    ...CrmImportFileSchema.shape,
    mapping: CrmImportColumnsSchema.optional(),
    mapping_profile: z.number().int().positive().nullable().optional(),
    source_id: z.number().int().positive(),
    user_id: z.number().int().positive().nullable().optional(),
  })
  .refine((body) => (body.mapping !== undefined) !== !!body.mapping_profile, 'send a mapping or a mapping profile, not both')

// Stable machine codes; the UI translates them.
export const CrmImportInvalidReasonSchema = z.enum([
  'missing_name',
  'name_too_long',
  'missing_phone',
  'invalid_phone',
  'invalid_email',
  'unknown_package',
])

export const CrmImportPreviewSchema = z.strictObject({
  new: z.number().int().min(0),
  duplicate: z.number().int().min(0),
  invalid: z.number().int().min(0),
  invalid_rows: z.array(z.strictObject({ row: z.number().int().min(2), reason: CrmImportInvalidReasonSchema })),
  duplicate_rows: z.array(z.number().int().min(2)),
})

export const CrmImportBatchSchema = z.strictObject({
  id: z.number().int(),
  file_name: z.string(),
  user: RefSchema.nullable(),
  source: RefSchema.nullable(),
  created: z.number().int().min(0),
  duplicate: z.number().int().min(0),
  invalid: z.number().int().min(0),
  unassigned: z.number().int().min(0),
  created_at: IsoDateTimeSchema,
})

export const CrmImportBatchListSchema = z.strictObject({
  items: z.array(CrmImportBatchSchema),
  total: z.number().int().min(0),
})

export type CrmImportColumns = z.infer<typeof CrmImportColumnsSchema>
export type CrmImportFile = z.infer<typeof CrmImportFileSchema>
export type CrmImportFileInfo = z.infer<typeof CrmImportFileInfoSchema>
export type CrmImportMapping = z.infer<typeof CrmImportMappingSchema>
export type CrmImportMappingList = z.infer<typeof CrmImportMappingListSchema>
export type CrmImportMappingCreate = z.infer<typeof CrmImportMappingCreateSchema>
export type CrmImportRequest = z.infer<typeof CrmImportRequestSchema>
export type CrmImportInvalidReason = z.infer<typeof CrmImportInvalidReasonSchema>
export type CrmImportPreview = z.infer<typeof CrmImportPreviewSchema>
export type CrmImportBatch = z.infer<typeof CrmImportBatchSchema>
export type CrmImportBatchList = z.infer<typeof CrmImportBatchListSchema>
