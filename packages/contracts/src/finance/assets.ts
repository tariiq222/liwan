import { z } from 'zod'
import { currency, day, FinanceRefSchema, id, list, money, text } from './shared'

export const FinanceAssetStateSchema = z.enum(['draft', 'open', 'close', 'removed'])
const MethodSchema = z.enum(['linear', 'linear-limit', 'degressive', 'degr-linear', 'degr-limit'])
const MethodTimeSchema = z.enum(['year', 'number'])
const MethodPeriodSchema = z.enum(['month', 'quarter', 'year'])

export const FinanceAssetProfileSchema = z.object({
  id,
  name: z.string(),
  method: MethodSchema,
  method_time: MethodTimeSchema,
  method_number: z.number().int(),
  method_period: MethodPeriodSchema,
  prorata: z.boolean(),
  asset_account: FinanceRefSchema,
  depreciation_account: FinanceRefSchema,
  expense_account: FinanceRefSchema,
  journal: FinanceRefSchema,
}).strict()

export const FinanceAssetSchema = z.object({
  id,
  name: z.string(),
  code: z.string(),
  state: FinanceAssetStateSchema,
  profile: FinanceRefSchema,
  partner: FinanceRefSchema.nullable(),
  date_start: day,
  currency,
  purchase_value: z.number(),
  salvage_value: z.number(),
  depreciation_base: z.number(),
  value_depreciated: z.number(),
  value_residual: z.number(),
}).strict()

export const FinanceDepreciationLineSchema = z.object({
  id,
  /** `create` is the acquisition line of the board, `depreciate` a period, `remove` the disposal. */
  type: z.enum(['create', 'depreciate', 'remove']),
  date: day,
  amount: z.number(),
  depreciated_value: z.number(),
  remaining_value: z.number(),
  /** True once the depreciation entry is posted. */
  posted: z.boolean(),
  entry: FinanceRefSchema.nullable(),
}).strict()

export const FinanceAssetDetailSchema = FinanceAssetSchema.extend({
  note: z.string(),
  method: MethodSchema,
  method_time: MethodTimeSchema,
  method_number: z.number().int(),
  method_period: MethodPeriodSchema,
  prorata: z.boolean(),
  lines: z.array(FinanceDepreciationLineSchema),
}).strict()

export const FinanceAssetListSchema = list(FinanceAssetSchema)
export const FinanceAssetProfileListSchema = list(FinanceAssetProfileSchema)

/** POST /assets: a draft on a profile, whose method it takes. */
export const FinanceAssetCreateSchema = z.object({
  profile_id: id,
  name: text.min(1),
  code: z.string().max(32).optional(),
  purchase_value: money.gt(0),
  salvage_value: money.min(0).optional(),
  date_start: day,
  partner_id: id.nullable().optional(),
  note: text.optional(),
}).strict()

/** POST /assets/compute-depreciation: posts the due lines of running assets up to `date`. */
export const FinanceAssetComputeInputSchema = z.object({ date: day }).strict()
export const FinanceAssetComputeResultSchema = z.object({
  date: day,
  entries: z.array(FinanceRefSchema),
}).strict()

export type FinanceAssetProfile = z.infer<typeof FinanceAssetProfileSchema>
export type FinanceAsset = z.infer<typeof FinanceAssetSchema>
export type FinanceAssetDetail = z.infer<typeof FinanceAssetDetailSchema>
export type FinanceAssetCreate = z.infer<typeof FinanceAssetCreateSchema>
export type FinanceAssetComputeResult = z.infer<typeof FinanceAssetComputeResultSchema>
