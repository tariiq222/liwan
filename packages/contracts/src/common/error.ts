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
