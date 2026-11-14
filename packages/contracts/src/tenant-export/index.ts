import { z } from 'zod'

const CountSchema = z.number().int().nonnegative()

export const TENANT_EXPORT_STATES = ['requested', 'running', 'done', 'failed', 'expired'] as const

/** What a finished export holds: rows per dataset key, the number of files and of models left out of it. */
export const TenantExportCountsSchema = z.object({
  rows: z.record(z.string(), CountSchema),
  files: CountSchema,
  not_included: CountSchema,
}).strict()

/** One run of the tenant data export (`GET`/`POST /api/v1/tenant-export`). */
export const TenantExportSchema = z.object({
  id: z.number().int().positive(),
  state: z.enum(TENANT_EXPORT_STATES),
  requested_at: z.iso.datetime().nullable(),
  started_at: z.iso.datetime().nullable(),
  finished_at: z.iso.datetime().nullable(),
  expires_at: z.iso.datetime().nullable(),
  failure: z.string().nullable(),
  size_bytes: CountSchema,
  counts: TenantExportCountsSchema.nullable(),
  downloadable: z.boolean(),
}).strict()

/** The latest runs, newest first, and how many days a finished archive stays downloadable. */
export const TenantExportListSchema = z.object({
  items: z.array(TenantExportSchema),
  total: CountSchema,
  retention_days: z.number().int().positive(),
}).strict()

/** The request takes no field: the export always covers the whole tenant. */
export const TenantExportRequestSchema = z.object({}).strict()

export type TenantExport = z.infer<typeof TenantExportSchema>
export type TenantExportList = z.infer<typeof TenantExportListSchema>
