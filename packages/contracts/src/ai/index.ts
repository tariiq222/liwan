import { z } from 'zod'

export const AiToolKindSchema = z.enum(['read', 'write_light', 'draft'])
export const AiRouteSchema = z.object({ method: z.enum(['GET', 'POST', 'PATCH']), path: z.string().startsWith('/api/v1/') }).strict()

export const AiToolSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  kind: AiToolKindSchema,
  description: z.object({ ar: z.string().min(1), en: z.string().min(1) }).strict(),
  input_schema: z.record(z.string(), z.unknown()),
  route: AiRouteSchema.nullable(),
  input_map: z.partialRecord(z.enum(['path', 'query', 'body']), z.record(z.string(), z.unknown())),
  result_summary: z.array(z.string()),
  draft_target: z.string().startsWith('/').nullable(),
}).strict().refine(tool => (tool.kind === 'draft') === (tool.route === null && tool.draft_target !== null), {
  message: 'a draft tool has a draft_target and no route; other tools have a route',
})
export type AiTool = z.infer<typeof AiToolSchema>

export const AiLimitsSchema = z.object({
  tool_calls_per_run: z.number().int().nonnegative().nullable(),
  messages_monthly: z.number().int().nonnegative().nullable(),
  messages_used: z.number().int().nonnegative(),
}).strict()

export const AiToolsResponseSchema = z.object({ items: z.array(AiToolSchema), total: z.number().int().nonnegative(), limits: AiLimitsSchema }).strict()
export type AiToolsResponse = z.infer<typeof AiToolsResponseSchema>

export const AiAuditKindSchema = z.enum(['message', 'read', 'write_light', 'draft'])
export const AiAuditResultSchema = z.enum(['ok', 'denied', 'failed', 'proposed', 'approved', 'rejected'])
export const AiAuditRequestSchema = z.object({
  conversation_id: z.string().min(1).max(64),
  kind: AiAuditKindSchema,
  tool_name: z.string().nullable(),
  input: z.record(z.string(), z.unknown()).nullable(),
  result: AiAuditResultSchema,
  http_status: z.number().int().min(100).max(599).nullable(),
  draft: z.record(z.string(), z.unknown()).nullable(),
  approved: z.record(z.string(), z.unknown()).nullable(),
  attested: z.boolean(),
}).strict().refine(body => body.result !== 'approved' || body.attested, { message: 'an approved draft needs attestation', path: ['attested'] })
export type AiAuditRequest = z.infer<typeof AiAuditRequestSchema>
export const AiAuditReceiptSchema = z.object({ id: z.number().int().positive(), messages_used: z.number().int().nonnegative(), messages_limit: z.number().int().nonnegative().nullable() }).strict()
export type AiAuditReceipt = z.infer<typeof AiAuditReceiptSchema>

export const AiRecordRefSchema = z.object({ type: z.string(), id: z.number().int(), label: z.string() }).strict()
export type AiRecordRef = z.infer<typeof AiRecordRefSchema>
export const AiToolRequestSchema = z.object({
  call_id: z.string(), tool: z.string(), kind: AiToolKindSchema, input: z.record(z.string(), z.unknown()),
  summary_ar: z.string(), summary_en: z.string(),
}).strict()
export type AiToolRequest = z.infer<typeof AiToolRequestSchema>
/** What a `done` event can say; the service never ends a stream while executing. */
export const AiDoneStatusSchema = z.enum(['running', 'waiting_tool', 'waiting_user', 'done', 'failed', 'limit_reached'])
/** What the run status endpoint can say: a claimed write_light call puts the run in `executing`. */
export const AiRunStatusValueSchema = z.enum([...AiDoneStatusSchema.options, 'executing'])
export type AiRunStatusValue = z.infer<typeof AiRunStatusValueSchema>
export const AiEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('run'), data: z.object({ run_id: z.string() }).strict() }),
  z.object({ event: z.literal('token'), data: z.object({ text: z.string() }).strict() }),
  z.object({ event: z.literal('tool_request'), data: AiToolRequestSchema }),
  z.object({ event: z.literal('tool_result'), data: z.object({ call_id: z.string(), tool: z.string(), kind: AiToolKindSchema, ok: z.boolean(), summary_ar: z.string(), summary_en: z.string() }).strict() }),
  z.object({ event: z.literal('answer'), data: z.object({ text: z.string(), records: z.array(AiRecordRefSchema) }).strict() }),
  z.object({ event: z.literal('limit_reached'), data: z.object({ limit: z.enum(['max_tool_calls', 'max_steps', 'timeout', 'messages_monthly']) }).strict() }),
  z.object({ event: z.literal('error'), data: z.object({ code: z.string(), message: z.string() }).strict() }),
  z.object({ event: z.literal('done'), data: z.object({ status: AiDoneStatusSchema }).strict() }),
])
export type AiEvent = z.infer<typeof AiEventSchema>

/**
 * Provider usage. `model_call` and `model_usage` go from the AI service to the Nuxt server only (they are not part of
 * `AiEventSchema`, which is the browser stream); the Nuxt server then reports the pairs to Odoo in batches.
 */
export const AI_USAGE_BATCH_MAX = 64
export const AiModelCallKindSchema = z.enum(['plan', 'title'])
export const AiModelCallOutcomeSchema = z.enum(['ok', 'failed', 'retried', 'aborted'])
const AiCallIdSchema = z.string().regex(/^[0-9a-f]{16}$/)
const AiProviderNameSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/)
const AiModelNameSchema = z.string().min(1).max(128).refine(value => !/[\u0000-\u001f\u007f-\u009f]/.test(value), 'no control characters')
const AiTokenCountSchema = z.number().int().nonnegative().max(100_000_000).nullable()
const tokensComeInPairs = (value: { input_tokens: number | null, output_tokens: number | null }) => (value.input_tokens === null) === (value.output_tokens === null)
const TOKENS_IN_PAIRS = { message: 'input_tokens and output_tokens are both set or both null', path: ['output_tokens'] }

export const AiModelCallEventSchema = z.object({
  call_id: AiCallIdSchema, kind: AiModelCallKindSchema, provider: AiProviderNameSchema, model: AiModelNameSchema,
  called_at: z.iso.datetime({ offset: true }),
}).strict()
export type AiModelCallEvent = z.infer<typeof AiModelCallEventSchema>
export const AiModelUsageEventSchema = z.object({
  call_id: AiCallIdSchema, outcome: AiModelCallOutcomeSchema, input_tokens: AiTokenCountSchema, output_tokens: AiTokenCountSchema,
}).strict().refine(tokensComeInPairs, TOKENS_IN_PAIRS)
export type AiModelUsageEvent = z.infer<typeof AiModelUsageEventSchema>

const AiUsageFields = {
  conversation_id: z.string().min(1).max(64), kind: AiModelCallKindSchema, provider: AiProviderNameSchema, model: AiModelNameSchema,
  outcome: AiModelCallOutcomeSchema, input_tokens: AiTokenCountSchema, output_tokens: AiTokenCountSchema, called_at: z.iso.datetime({ offset: true }),
}
/** One provider attempt as `POST /api/v1/ai/usage` records it. */
export const AiUsageRecordSchema = z.object(AiUsageFields).strict().refine(tokensComeInPairs, TOKENS_IN_PAIRS)
export type AiUsageRecord = z.infer<typeof AiUsageRecordSchema>
export const AiUsageBatchSchema = z.object({ items: z.array(AiUsageRecordSchema).min(1).max(AI_USAGE_BATCH_MAX) }).strict()
export type AiUsageBatch = z.infer<typeof AiUsageBatchSchema>
export const AiUsageRowSchema = z.object({ id: z.number().int().positive(), ...AiUsageFields }).strict().refine(tokensComeInPairs, TOKENS_IN_PAIRS)
export type AiUsageRow = z.infer<typeof AiUsageRowSchema>
export const AiUsageBatchResponseSchema = z.object({ items: z.array(AiUsageRowSchema), total: z.number().int().nonnegative() }).strict()
export type AiUsageBatchResponse = z.infer<typeof AiUsageBatchResponseSchema>

export const AiRunStatusSchema = z.object({
  run_id: z.string(),
  status: AiRunStatusValueSchema,
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }).strict()),
  pending: z.object({ call_id: z.string(), tool: z.string(), kind: AiToolKindSchema, input: z.record(z.string(), z.unknown()) }).strict().nullable(),
}).strict()
export type AiRunStatus = z.infer<typeof AiRunStatusSchema>

/** One row of the caller's own conversation history (`GET /api/ai/runs`); `title` is null for a run started before titles existed. */
export const AiRunSummarySchema = z.object({
  run_id: z.string(),
  title: z.string().nullable(),
  status: AiRunStatusValueSchema,
  updated_at: z.iso.datetime({ offset: true }),
  archived: z.boolean(),
}).strict()
export type AiRunSummary = z.infer<typeof AiRunSummarySchema>
export const AiRunListSchema = z.object({ items: z.array(AiRunSummarySchema), total: z.number().int().nonnegative() }).strict()
export type AiRunList = z.infer<typeof AiRunListSchema>

/** `GET /api/ai/runs?archived=true` lists only the archived conversations; without it, only the active ones. */
export const AiRunListQuerySchema = z.object({ archived: z.enum(['true', 'false']).optional() })

export const AI_RUN_TITLE_MAX_CHARS = 80
/** `PATCH /api/ai/runs/{id}`: a rename (which the model then never overwrites) and/or an archive flag; at least one of them. */
export const AiRunPatchSchema = z.object({
  title: z.string().trim().min(1).max(AI_RUN_TITLE_MAX_CHARS).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'no control characters').optional(),
  archived: z.boolean().optional(),
}).strict().refine(value => value.title !== undefined || value.archived !== undefined, 'send a title, archived, or both')
export type AiRunPatch = z.infer<typeof AiRunPatchSchema>

/** `POST /api/ai/runs`: `context` is the page the assistant was opened from, `run_id` continues an existing run. */
export const AiStartRequestSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  run_id: z.string().min(1).max(64).nullish(),
  context: z.object({ page: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), id: z.number().int().nullish() }).strict().nullish(),
}).strict()
export type AiStartRequest = z.infer<typeof AiStartRequestSchema>

const Text = z.string().max(4000)
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
// Contract ع5: unknown keys are dropped (strip), the name is required.
export const AiDraftPayloadSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: Text.optional(),
  date_start: Day.optional(),
  date_end: Day.optional(),
  charter: z.object({
    rationale: Text.optional(),
    objectives: z.array(z.string().max(500)).max(10).optional(),
    scope: Text.optional(), exclusions: Text.optional(), success: Text.optional(),
    assumptions: Text.optional(), constraints: Text.optional(),
  }).optional(),
})
export type AiDraftPayload = z.infer<typeof AiDraftPayloadSchema>

/** What `/ai` stores for `/projects/new?aiDraft=<id>` (sessionStorage key `liwan:ai-draft:<id>`). */
export const AiDraftHandoffSchema = z.object({
  run_id: z.string(), call_id: z.string(), tool: z.string(), payload: AiDraftPayloadSchema,
}).strict()
export type AiDraftHandoff = z.infer<typeof AiDraftHandoffSchema>
