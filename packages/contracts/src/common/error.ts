import { z } from 'zod'

// The error envelope every /api/v1 endpoint returns (see
// odoo-addons/liwan_api/controllers/common.py::ApiError) - shared plumbing,
// not a pillar's.
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  field: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict()

/**
 * `details` of the 422 `export_too_large` every CSV export answers when its filters keep more rows than one file
 * carries (odoo-addons/liwan_api/serializers/csv_export.py): the user narrows the filters and exports again.
 */
export const ExportTooLargeDetailsSchema = z.object({
  rows: z.number().int().positive(),
  max_rows: z.number().int().positive(),
}).strict()
export type ExportTooLargeDetails = z.infer<typeof ExportTooLargeDetailsSchema>
