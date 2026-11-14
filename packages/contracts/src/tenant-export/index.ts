import { z } from 'zod'

const CountSchema = z.number().int().nonnegative()

export const TENANT_EXPORT_STATES = ['requested', 'running', 'done', 'failed', 'expired'] as const

/** What a finished export holds: rows per dataset key, the files and their bytes, and the cells moved to side files. */
export const TenantExportCountsSchema = z.object({
  rows: z.record(z.string(), CountSchema),
  files: CountSchema,
  file_bytes: CountSchema,
  overflow_cells: CountSchema,
}).strict()

export const TENANT_EXPORT_FAILURES = ['insufficient_disk', 'build_failed', 'timeout', 'requester_not_authorized'] as const

/** A fixed failure code and its message; the exception text stays in the server log. */
export const TenantExportFailureSchema = z.object({
  code: z.enum(TENANT_EXPORT_FAILURES),
  message: z.string().min(1),
}).strict()

/** One run of the tenant data export (`GET`/`POST /api/v1/admin/tenant-export`). */
export const TenantExportSchema = z.object({
  id: z.number().int().positive(),
  state: z.enum(TENANT_EXPORT_STATES),
  requested_at: z.iso.datetime().nullable(),
  started_at: z.iso.datetime().nullable(),
  finished_at: z.iso.datetime().nullable(),
  expires_at: z.iso.datetime().nullable(),
  failure: TenantExportFailureSchema.nullable(),
  steps_done: CountSchema,
  steps_total: CountSchema,
  size_bytes: CountSchema,
  counts: TenantExportCountsSchema.nullable(),
  downloadable: z.boolean(),
}).strict()

/**
 * The latest ten runs, newest first, with the real count of runs, the time the next request is possible (`null` now),
 * and how long an archive stays downloadable.
 */
export const TenantExportListSchema = z.object({
  items: z.array(TenantExportSchema).max(10),
  total: CountSchema,
  next_request_at: z.iso.datetime().nullable(),
  retention_days: z.number().int().positive(),
  cooldown_hours: z.number().int().positive(),
}).strict()

/** The request takes no field: the export always covers the whole tenant. */
export const TenantExportRequestSchema = z.object({}).strict()

export type TenantExport = z.infer<typeof TenantExportSchema>
export type TenantExportList = z.infer<typeof TenantExportListSchema>
