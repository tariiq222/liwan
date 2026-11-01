import { z } from 'zod'
import { CurrencyRefSchema } from './project-charter'
import { CalendarDateSchema } from './schedule'

// How earned value counts a task's progress: a done task is 100% and any other 0% (`binary`), or the percent the assignee enters (`manual`).
export const EvmProgressMethodSchema = z.enum(['binary', 'manual'])
export const EVM_PROGRESS_METHODS = EvmProgressMethodSchema.options

// Amounts are in the baseline's currency. A figure is null where its divisor is not positive ("not enough data"). Three cases
// leave less: a baseline without budget (bac 0) keeps the schedule index only; with undated lines (`undated_count`) PV, EV, SV and SPI
// cover the dated lines and every cost index is null; with lines the caller cannot read (`hidden_count`) every plan-based figure is
// null and the curve is empty, leaving `bac` and `ac`.
const nullableAmount = z.number().nullable()

export const EvmCurvePointSchema = z.object({ date: CalendarDateSchema, pv: z.number() }).strict()

// GET /api/v1/projects/{id}/evm: earned value against the latest baseline, as of the caller's calendar day.
export const ProjectEvmSchema = z.object({
  project_id: z.number().int().positive(),
  baseline_number: z.number().int().positive(),
  computed_at: z.string(),
  as_of: CalendarDateSchema,
  currency: CurrencyRefSchema.nullable(),
  method: EvmProgressMethodSchema,
  // Baseline lines the caller may not read (no figures are sent for them) and lines without an end date, which take part in neither PV nor EV.
  hidden_count: z.number().int().nonnegative(),
  undated_count: z.number().int().nonnegative(),
  bac: z.number(),
  pv: nullableAmount,
  ev: nullableAmount,
  ac: z.number(),
  sv: nullableAmount,
  cv: nullableAmount,
  spi: nullableAmount,
  cpi: nullableAmount,
  eac: nullableAmount,
  etc: nullableAmount,
  vac: nullableAmount,
  tcpi: nullableAmount,
  planned_curve: z.array(EvmCurvePointSchema),
}).strict()

export type EvmProgressMethod = z.infer<typeof EvmProgressMethodSchema>
export type EvmCurvePoint = z.infer<typeof EvmCurvePointSchema>
export type ProjectEvm = z.infer<typeof ProjectEvmSchema>
