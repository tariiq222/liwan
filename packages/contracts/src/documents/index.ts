import { z } from 'zod'

const id = z.number().int().positive()
const revision = z.number().int().positive()
const visibility = z.enum(['company', 'restricted'])
const grantAccess = z.enum(['reader', 'editor'])
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const tagIds = z.array(id).refine(value => new Set(value).size === value.length, 'Tag ids must be unique')
const contextInput = z.object({ kind: z.string().trim().min(1), id }).strict()

export const DocumentTagSchema = z.object({ id, name: z.string() }).strict()
export const DocumentTagListSchema = z.object({ items: z.array(DocumentTagSchema), total: z.number().int().nonnegative() }).strict()
export const DocumentContextSchema = contextInput.extend({ label: z.string().nullable(), href: z.string().nullable() }).strict()
export const DocumentContextListSchema = z.object({
  items: z.array(z.object({ kind: z.string(), label: z.string() }).strict()), total: z.number().int().nonnegative(),
}).strict()
export const DocumentContextOptionListSchema = z.object({
  items: z.array(z.object({ id, name: z.string() }).strict()), total: z.number().int().nonnegative(),
}).strict()
export const DocumentFileSchema = z.object({
  id, name: z.string(), mimetype: z.string(), file_size: z.number().int().nonnegative(), active: z.boolean(),
  is_locked: z.boolean(), is_lock_editor: z.boolean(),
  download_url: z.string().regex(/^\/api\/v1\/documents\/[1-9]\d*\/files\/[1-9]\d*\/download$/),
  allowed_actions: z.object({ archive: z.boolean(), restore: z.boolean(), lock: z.boolean(), unlock: z.boolean() }).strict(),
}).strict()
export const DocumentFileListSchema = z.object({ items: z.array(DocumentFileSchema), total: z.number().int().nonnegative(), revision }).strict()
export const DocumentSummarySchema = z.object({
  id, name: z.string(), visibility, active: z.boolean(), expiry_date: date.nullable(), write_date: z.string(), revision,
  file_count: z.number().int().nonnegative(), tags: z.array(DocumentTagSchema), context: DocumentContextSchema.nullable(),
  allowed_actions: z.object({ update: z.boolean(), archive: z.boolean(), restore: z.boolean(), upload_file: z.boolean(), manage_access: z.boolean() }).strict(),
}).strict()
export const DocumentDetailSchema = DocumentSummarySchema.extend({ body: z.string() }).strict()
export const DocumentListSchema = z.object({ items: z.array(DocumentSummarySchema), total: z.number().int().nonnegative() }).strict()
export const DocumentCreateSchema = z.object({
  name: z.string().trim().min(1), body: z.string().optional(), expiry_date: date.nullable().optional(),
  context: contextInput.nullable().optional(), tag_ids: tagIds.optional(),
}).strict()
export const DocumentPatchSchema = DocumentCreateSchema.partial().extend({ expected_revision: revision }).strict()
  .refine(value => Object.keys(value).some(key => key !== 'expected_revision'), 'At least one changed field is required')
export const DocumentRevisionSchema = z.object({ expected_revision: revision }).strict()
export const DocumentAccessSchema = z.object({
  visibility, revision, grants: z.array(z.object({ user: z.object({ id, name: z.string() }).strict(), access: grantAccess }).strict()),
}).strict()
export const DocumentAccessUpdateSchema = z.object({
  expected_revision: revision, visibility,
  grants: z.array(z.object({ user_id: id, access: grantAccess }).strict()),
}).strict().refine(value => value.grants.some(grant => grant.access === 'editor'), 'An editor is required')
  .refine(value => new Set(value.grants.map(grant => grant.user_id)).size === value.grants.length, 'Grant users must be unique')
export const DocumentUploadSchema = z.object({
  expected_revision: revision, name: z.string().trim().min(1).refine(value => !/[\\/\0]/.test(value) && !['.', '..'].includes(value), 'A basename is required'),
  data: z.string().min(1), mimetype: z.string().optional(), as_version: z.boolean().optional(),
}).strict()

export type DocumentSummary = z.infer<typeof DocumentSummarySchema>
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>
export type DocumentFile = z.infer<typeof DocumentFileSchema>
export type DocumentList = z.infer<typeof DocumentListSchema>
export type DocumentTag = z.infer<typeof DocumentTagSchema>
export type DocumentTagList = z.infer<typeof DocumentTagListSchema>
export type DocumentContext = z.infer<typeof DocumentContextSchema>
export type DocumentContextList = z.infer<typeof DocumentContextListSchema>
export type DocumentContextOptionList = z.infer<typeof DocumentContextOptionListSchema>
export type DocumentCreate = z.infer<typeof DocumentCreateSchema>
export type DocumentPatch = z.infer<typeof DocumentPatchSchema>
export type DocumentAccess = z.infer<typeof DocumentAccessSchema>
export type DocumentAccessUpdate = z.infer<typeof DocumentAccessUpdateSchema>
export type DocumentUpload = z.infer<typeof DocumentUploadSchema>

export type DocumentFileList = z.infer<typeof DocumentFileListSchema>
