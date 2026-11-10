import { z } from 'zod'
import { ProjectObjectiveWriteSchema } from '../pmo/project'

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
  /** The model an approved draft's record lives in; Odoo verifies the approval against it (issue #556). */
  draft_model: z.string().regex(/^[a-z][a-z0-9_.]*$/).nullable(),
  /** Every write and draft waits for the user; a read waits only when the administrator set it to approval. */
  requires_approval: z.boolean(),
  /** A platform tool (such as `ai.search_knowledge`) belongs to no agent: it is read-only and offered to every agent. */
  platform: z.boolean(),
}).strict().refine(tool => (tool.kind === 'draft') === (tool.route === null && tool.draft_target !== null && tool.draft_model !== null), {
  message: 'a draft tool has a draft_target, a draft_model and no route; other tools have a route and neither of the two',
}).refine(tool => !tool.platform || tool.kind === 'read', { message: 'a platform tool is a read tool' })
export type AiTool = z.infer<typeof AiToolSchema>

const AiTextSchema = z.object({ ar: z.string().min(1), en: z.string().min(1) }).strict()
const AiAgentKeySchema = z.string().regex(/^[a-z][a-z0-9_]*$/)
/** One specialist agent of an enabled application (`liwan.ai.agent.registry`); `core` is the platform coordinator. */
export const AiAgentSchema = z.object({
  key: AiAgentKeySchema,
  name: AiTextSchema,
  description: AiTextSchema,
  instructions: AiTextSchema,
  pages: z.array(z.string().regex(/^[a-z][a-z_-]{0,39}$/)),
  /** The administrator's switch: the agent may save and read employee and company notes. */
  memory: z.boolean(),
}).strict()
export type AiAgent = z.infer<typeof AiAgentSchema>
export const AI_CORE_AGENT = 'core'
/** The setup agent of liwan_ai: its tools exist only in a setup conversation. */
export const AI_SETUP_AGENT = 'ai'
/** The help agent of liwan_ai: its tools exist only in a help conversation. */
export const AI_HELP_AGENT = 'ai_help'
/** The modes of the free agents: a conversation with the setup agent only, or with the help agent only. */
export const AiConversationModeSchema = z.enum(['setup', 'help'])
export type AiConversationMode = z.infer<typeof AiConversationModeSchema>

const AiLimitValueSchema = z.number().int().nonnegative().nullable() // null means unlimited
export const AiProviderModeSchema = z.enum(['platform', 'tenant_key'])
export type AiProviderMode = z.infer<typeof AiProviderModeSchema>

/** Why a new run of the paid assistant is refused now: the balance (and free allowance) is used up, or the monthly spend ceiling is reached. */
export const AiBlockedSchema = z.enum(['ai_balance_empty', 'ai_spend_ceiling']).nullable()
const AiResetSchema = z.iso.datetime({ offset: true }).nullable()

/** What a run needs from the tenant's AI policy (Odoo `liwan_ai`); the Nuxt server passes it to the AI service. */
export const AiPolicySchema = z.object({
  provider_mode: AiProviderModeSchema,
  /** The tenant signed the current AI acknowledgement: no provider runs a request without it (spec 2026-11-04 §6.8). */
  consent_signed: z.boolean(),
  output_tokens_per_run: AiLimitValueSchema,
  /** The tenant's own ceiling on the input tokens of one request (issue #554); null means no ceiling of its own. */
  input_tokens_per_run: AiLimitValueSchema,
  /**
   * The prepaid balance of the paid assistant, in cost units (0.00001 USD). Every user gets what is needed to refuse and explain:
   * `blocked` (the refusal a new run meets now, or null), `blocked_resets_at` (when that refusal lifts: the free allowance
   * renewal for `ai_balance_empty`, the month's end for `ai_spend_ceiling`) and `allowance_resets_at`. The figures below are
   * billing data and go only to a holder of `ai.settings.manage`; for anyone else they are null, as they are for a tenant with
   * no balance (customer-hosted) or, for `spend_ceiling`, no ceiling.
   */
  blocked: AiBlockedSchema,
  blocked_resets_at: AiResetSchema,
  allowance_resets_at: AiResetSchema,
  balance_granted: AiLimitValueSchema,
  balance_left: AiLimitValueSchema,
  allowance: AiLimitValueSchema,
  allowance_left: AiLimitValueSchema,
  spend_ceiling: AiLimitValueSchema,
  spend_this_month: AiLimitValueSchema,
}).strict()
export type AiPolicy = z.infer<typeof AiPolicySchema>

export const AiLimitsSchema = z.object({
  tool_calls_per_run: AiLimitValueSchema,
  messages_monthly: AiLimitValueSchema,
  messages_used: z.number().int().nonnegative(),
  /** The free agents' (setup and help) one monthly budget (vendor-set) and this month's messages against it. */
  assist_monthly: AiLimitValueSchema,
  assist_used: z.number().int().nonnegative(),
  policy: AiPolicySchema,
}).strict()

export const AiToolsResponseSchema = z.object({
  items: z.array(AiToolSchema), total: z.number().int().nonnegative(), agents: z.array(AiAgentSchema), limits: AiLimitsSchema,
  /** Field names no tool result may carry at any depth (the outbound data policy, spec 2026-11-04 §6.12); the Nuxt executor strips them. */
  blocked_fields: z.array(z.string().min(1)),
}).strict()
export type AiToolsResponse = z.infer<typeof AiToolsResponseSchema>

/** `setup` and `help`: a user message of a free agent's conversation, counted against the assistance budget instead of the package. */
export const AiAuditKindSchema = z.enum(['message', 'setup', 'help', 'read', 'write_light', 'draft'])
export const AiAuditResultSchema = z.enum(['ok', 'denied', 'failed', 'proposed', 'approved', 'rejected'])
export const AiAuditRequestSchema = z.object({
  conversation_id: z.string().min(1).max(64),
  kind: AiAuditKindSchema,
  /** The agent that was active when a tool ran; absent on a message row. */
  agent: AiAgentKeySchema.optional(),
  tool_name: z.string().nullable(),
  input: z.record(z.string(), z.unknown()).nullable(),
  result: AiAuditResultSchema,
  http_status: z.number().int().min(100).max(599).nullable(),
  draft: z.record(z.string(), z.unknown()).nullable(),
  approved: z.record(z.string(), z.unknown()).nullable(),
}).strict()
export type AiAuditRequest = z.infer<typeof AiAuditRequestSchema>
export const AiAuditReceiptSchema = z.object({ id: z.number().int().positive(), messages_used: z.number().int().nonnegative(), messages_limit: z.number().int().nonnegative().nullable() }).strict()
export type AiAuditReceipt = z.infer<typeof AiAuditReceiptSchema>

/**
 * What an approved draft names: the record the real create page made (`POST /api/ai/runs/{id}/resume`, issue #556). A
 * strict shape, so an approval cannot smuggle anything else into the audit row; Odoo still verifies the record itself.
 */
export const AiApprovedDraftSchema = z.object({ id: z.number().int().positive() }).strict()
export type AiApprovedDraft = z.infer<typeof AiApprovedDraftSchema>

export const AiRecordRefSchema = z.object({ type: z.string(), id: z.number().int(), label: z.string() }).strict()
export type AiRecordRef = z.infer<typeof AiRecordRefSchema>
export const AiToolRequestSchema = z.object({
  call_id: z.string(), tool: z.string(), kind: AiToolKindSchema, agent: AiAgentKeySchema, requires_approval: z.boolean(),
  input: z.record(z.string(), z.unknown()), summary_ar: z.string(), summary_en: z.string(),
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
  /** The conversation was handed over to another specialist agent. */
  z.object({ event: z.literal('agent'), data: z.object({ agent: AiAgentKeySchema, name: AiTextSchema }).strict() }),
  z.object({ event: z.literal('tool_request'), data: AiToolRequestSchema }),
  z.object({ event: z.literal('tool_result'), data: z.object({ call_id: z.string(), tool: z.string(), kind: AiToolKindSchema, ok: z.boolean(), summary_ar: z.string(), summary_en: z.string() }).strict() }),
  z.object({ event: z.literal('answer'), data: z.object({ text: z.string(), records: z.array(AiRecordRefSchema) }).strict() }),
  z.object({ event: z.literal('limit_reached'), data: z.object({ limit: z.enum(['max_tool_calls', 'max_steps', 'timeout', 'messages_monthly', 'output_tokens', 'input_tokens']) }).strict() }),
  z.object({ event: z.literal('error'), data: z.object({ code: z.string(), message: z.string() }).strict() }),
  z.object({ event: z.literal('done'), data: z.object({ status: AiDoneStatusSchema }).strict() }),
])
export type AiEvent = z.infer<typeof AiEventSchema>

/**
 * Provider usage. `model_call` and `model_usage` go from the AI service to the Nuxt server only (they are not part of
 * `AiEventSchema`, which is the browser stream); the Nuxt server then reports the pairs to Odoo in batches.
 */
export const AI_USAGE_BATCH_MAX = 64
export const AiModelCallKindSchema = z.enum(['plan', 'title', 'route', 'summary'])
/** What kind of task a call served; the same four values as the AI service's `Capability` and Odoo's `USAGE_CAPABILITIES`. */
export const AiCapabilitySchema = z.enum(['quick', 'standard', 'analysis', 'writing'])
export type AiCapability = z.infer<typeof AiCapabilitySchema>
/** Whose account paid a call: the platform's, the tenant's own key, or the vendor's setup budget (the free setup agent). */
export const AiBillingSchema = z.enum([...AiProviderModeSchema.options, 'setup'])
export const AiModelCallOutcomeSchema = z.enum(['ok', 'failed', 'retried', 'aborted'])
const AiCallIdSchema = z.string().regex(/^[0-9a-f]{16}$/)
const AiProviderNameSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/)
const AiModelNameSchema = z.string().min(1).max(128).refine(value => !/[\u0000-\u001f\u007f-\u009f]/.test(value), 'no control characters')
const AiTokenCountSchema = z.number().int().nonnegative().max(100_000_000).nullable()
/** Cost units (one unit is 0.00001 USD): what a call cost the vendor and what the tenant is charged; the bound is Odoo's integer column. */
export const AI_MAX_COST_UNITS = 2_147_483_647
const AiCostUnitsSchema = z.number().int().nonnegative().max(AI_MAX_COST_UNITS).nullable()
const tokensComeInPairs = (value: { input_tokens: number | null, output_tokens: number | null }) => (value.input_tokens === null) === (value.output_tokens === null)
const TOKENS_IN_PAIRS = { message: 'input_tokens and output_tokens are both set or both null', path: ['output_tokens'] }
/** A cost needs token counts and a charge needs a cost; a setup call has a cost and no charge (the vendor pays it). */
const costFollowsTokens = (value: { input_tokens: number | null, cost: number | null, charge: number | null }) => (value.cost === null || value.input_tokens !== null) && (value.charge === null || value.cost !== null)
/** A call on the tenant's own key has no cost or charge, and a setup call has no charge. */
const pricedByBilling = (value: { billing: string, cost: number | null, charge: number | null }) => value.billing === 'tenant_key' ? value.cost === null && value.charge === null : value.billing !== 'setup' || value.charge === null
const PRICED_BY_BILLING = { message: 'tenant_key calls carry no cost or charge and setup calls carry no charge', path: ['charge'] }
const COST_FOLLOWS_TOKENS = { message: 'cost needs token counts and charge needs a cost', path: ['cost'] }

export const AiModelCallEventSchema = z.object({
  call_id: AiCallIdSchema, kind: AiModelCallKindSchema, capability: AiCapabilitySchema, billing: AiBillingSchema, provider: AiProviderNameSchema, model: AiModelNameSchema,
  called_at: z.iso.datetime({ offset: true }),
}).strict()
export type AiModelCallEvent = z.infer<typeof AiModelCallEventSchema>
export const AiModelUsageEventSchema = z.object({
  call_id: AiCallIdSchema, outcome: AiModelCallOutcomeSchema, input_tokens: AiTokenCountSchema, output_tokens: AiTokenCountSchema,
  cost: AiCostUnitsSchema, charge: AiCostUnitsSchema,
}).strict().refine(tokensComeInPairs, TOKENS_IN_PAIRS).refine(costFollowsTokens, COST_FOLLOWS_TOKENS)
export type AiModelUsageEvent = z.infer<typeof AiModelUsageEventSchema>

const AiUsageFields = {
  conversation_id: z.string().min(1).max(64), call_id: AiCallIdSchema, kind: AiModelCallKindSchema, capability: AiCapabilitySchema, billing: AiBillingSchema,
  provider: AiProviderNameSchema, model: AiModelNameSchema, outcome: AiModelCallOutcomeSchema, input_tokens: AiTokenCountSchema, output_tokens: AiTokenCountSchema,
  cost: AiCostUnitsSchema, charge: AiCostUnitsSchema, called_at: z.iso.datetime({ offset: true }),
}
/** One provider attempt as `POST /api/v1/ai/usage` records it. */
export const AiUsageRecordSchema = z.object(AiUsageFields).strict().refine(tokensComeInPairs, TOKENS_IN_PAIRS).refine(costFollowsTokens, COST_FOLLOWS_TOKENS).refine(pricedByBilling, PRICED_BY_BILLING)
export type AiUsageRecord = z.infer<typeof AiUsageRecordSchema>
export const AiUsageBatchSchema = z.object({ items: z.array(AiUsageRecordSchema).min(1).max(AI_USAGE_BATCH_MAX) }).strict()
export type AiUsageBatch = z.infer<typeof AiUsageBatchSchema>
/**
 * The same batch as `POST /api/v1/ai/usage/service` records it: the Nuxt server reports it with the tenant's technical
 * recorder key, so the batch names the user who made the calls and the company they were made in (`user_company_id`, not `company_id`:
 * a payload `company_id` is the platform's own pinned-company guard). A row never names its own owner.
 */
export const AiUsageServiceBatchSchema = z.object({
  user_id: z.number().int().positive(), user_company_id: z.number().int().positive(),
  items: z.array(AiUsageRecordSchema).min(1).max(AI_USAGE_BATCH_MAX),
}).strict()
export type AiUsageServiceBatch = z.infer<typeof AiUsageServiceBatchSchema>
/**
 * The size rules of `POST /api/v1/ai/usage/service` (odoo-addons/liwan_ai/models/ai_usage.py), so the Nuxt server splits its
 * requests the way Odoo admits them. A row is one provider call, and no tighter number is a safe per-row bound: a per-run input
 * ceiling is checked between calls and 0 disables it. The only per-row bound is the AI service's own wire contract (`max_row_tokens`,
 * both counts); everything else is aggregate: `max_request_tokens` is the tenant-wide tokens-per-minute budget, two maximal rows, so
 * any one valid row fits an empty window and a request above it must be split. Odoo cannot import this file: a test
 * (apps/web/server/utils/ai/__tests__/usageCeilings.test.ts) reads Odoo and the AI service and fails when they drift.
 * `max_age_hours` bounds `called_at`; the web spool gives a row up after an hour, far inside it.
 */
export const AI_USAGE_SERVICE_LIMITS = { max_row_tokens: 100_000_000, max_request_tokens: 200_000_000, max_age_hours: 24 } as const
/** `charge_paid`: the part of the charge taken from the prepaid balance, set by Odoo only (never part of a report). */
export const AiUsageRowSchema = z.object({ id: z.number().int().positive(), ...AiUsageFields, charge_paid: z.number().int().nonnegative().max(AI_MAX_COST_UNITS) }).strict().refine(tokensComeInPairs, TOKENS_IN_PAIRS).refine(costFollowsTokens, COST_FOLLOWS_TOKENS).refine(pricedByBilling, PRICED_BY_BILLING)
export type AiUsageRow = z.infer<typeof AiUsageRowSchema>
export const AiUsageBatchResponseSchema = z.object({ items: z.array(AiUsageRowSchema), total: z.number().int().nonnegative() }).strict()
export type AiUsageBatchResponse = z.infer<typeof AiUsageBatchResponseSchema>

export const AiRunStatusSchema = z.object({
  run_id: z.string(),
  status: AiRunStatusValueSchema,
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }).strict()),
  pending: z.object({
    call_id: z.string(), tool: z.string(), kind: AiToolKindSchema, input: z.record(z.string(), z.unknown()),
    agent: AiAgentKeySchema, requires_approval: z.boolean(),
  }).strict().nullable(),
}).strict()
export type AiRunStatus = z.infer<typeof AiRunStatusSchema>
/** The mode of a conversation: `assistant` is the ordinary one. */
export const AiRunModeSchema = z.enum(['assistant', ...AiConversationModeSchema.options])
export type AiRunMode = z.infer<typeof AiRunModeSchema>
/** `GET /api/ai/runs/{id}`: the service's run status plus the mode the conversation started in (decided by Odoo, never by the URL). */
export const AiRunDetailSchema = AiRunStatusSchema.extend({ mode: AiRunModeSchema })
export type AiRunDetail = z.infer<typeof AiRunDetailSchema>

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

/** The longest message the AI service accepts (apps/ai-service contracts.RunRequest), after the outbound scan too. */
export const AI_MESSAGE_MAX = 8000

/** `POST /api/ai/runs`: `context` is the page the assistant was opened from, `run_id` continues an existing run. */
export const AiStartRequestSchema = z.object({
  message: z.string().trim().min(1).max(AI_MESSAGE_MAX),
  run_id: z.string().min(1).max(64).nullish(),
  /** `setup` or `help`: a conversation with that free agent only, on the platform provider, against the assistance budget. */
  mode: AiConversationModeSchema.nullish(),
  context: z.object({ page: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), id: z.number().int().nullish() }).strict().nullish(),
}).strict()
export type AiStartRequest = z.infer<typeof AiStartRequestSchema>

const Text = z.string().max(4000)
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
// Contract ع5: unknown keys are dropped (strip), the name is required.
export const AiDraftPayloadSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: Text.optional(),
  objectives: z.array(ProjectObjectiveWriteSchema).optional(),
  success_criteria: Text.optional(),
  date_start: Day.optional(),
  date_end: Day.optional(),
  charter: z.object({
    rationale: Text.optional(),
    scope: Text.optional(), exclusions: Text.optional(),
    assumptions: Text.optional(), constraints: Text.optional(),
  }).optional(),
})
export type AiDraftPayload = z.infer<typeof AiDraftPayloadSchema>

/** What `/ai` stores for `/projects/new?aiDraft=<id>` (sessionStorage key `liwan:ai-draft:<id>`). */
export const AiDraftHandoffSchema = z.object({
  run_id: z.string(), call_id: z.string(), tool: z.string(), payload: AiDraftPayloadSchema,
}).strict()
export type AiDraftHandoff = z.infer<typeof AiDraftHandoffSchema>

const AiPersonSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

/** `GET|PATCH /api/v1/ai/settings` (capability `ai.settings.manage`): provider mode, AI acknowledgement and this month's usage. */
/** How the assistant may reach an outside party: prepare a draft the employee sends, or send after approval. */
export const AiExternalSendSchema = z.enum(['draft_only', 'approve'])
export const AI_MESSAGES_PER_USER_MAX = 100_000
const AiMessagesPerUserSchema = z.number().int().min(0).max(AI_MESSAGES_PER_USER_MAX) // 0 means no cap per user
/** The tenant's ceiling on the input tokens of one request (issue #554); 0 means no cap of its own. */
export const AI_INPUT_TOKENS_PER_RUN_MAX = 2_000_000
const AiInputTokensPerRunSchema = z.number().int().min(0).max(AI_INPUT_TOKENS_PER_RUN_MAX)

/** The tenant's ceiling on what the paid assistant may take from the balance in a calendar month, in cost units (0.00001 USD); 0 means none. */
export const AI_MONTHLY_SPEND_CEILING_MAX = 2_147_483_647
const AiMonthlySpendCeilingSchema = z.number().int().min(0).max(AI_MONTHLY_SPEND_CEILING_MAX)

export const AiSettingsSchema = z.object({
  provider_mode: AiProviderModeSchema,
  messages_per_user_monthly: AiMessagesPerUserSchema,
  input_tokens_per_run: AiInputTokensPerRunSchema,
  monthly_spend_ceiling: AiMonthlySpendCeilingSchema,
  external_send: AiExternalSendSchema,
  /** Whether the assistant may search company records (knowledge retrieval); applies only while the consent is valid. */
  knowledge_enabled: z.boolean(),
  revision: z.number().int().positive(),
  consent: z.object({
    required_version: z.string().min(1),
    text_ar: z.string().min(1),
    text_en: z.string().min(1),
    text_hash: z.string().regex(/^[0-9a-f]{64}$/),
    signed: z.object({ user: AiPersonSchema, signed_at: z.iso.datetime({ offset: true }), text_version: z.string() }).strict().nullable(),
  }).strict(),
  usage: z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    messages_used: z.number().int().nonnegative(),
    messages_limit: AiLimitValueSchema,
    /** The free agents' (setup and help) messages against their one monthly budget. */
    assist_used: z.number().int().nonnegative(),
    assist_limit: AiLimitValueSchema,
    output_tokens_per_run: AiLimitValueSchema,
  }).strict(),
}).strict()
export type AiSettings = z.infer<typeof AiSettingsSchema>
export const AiSettingsPatchSchema = z.object({
  provider_mode: AiProviderModeSchema.optional(),
  messages_per_user_monthly: AiMessagesPerUserSchema.optional(),
  input_tokens_per_run: AiInputTokensPerRunSchema.optional(),
  monthly_spend_ceiling: AiMonthlySpendCeilingSchema.optional(),
  external_send: AiExternalSendSchema.optional(),
  knowledge_enabled: z.boolean().optional(),
  revision: z.number().int().positive(),
}).strict()
export type AiSettingsPatch = z.infer<typeof AiSettingsPatchSchema>
/** `POST /api/v1/ai/knowledge/rebuild` (capability `ai.settings.manage`): clears the index cursors and queues a full rebuild. */
export const AiKnowledgeRebuildSchema = z.object({ queued: z.literal(true) }).strict()
export type AiKnowledgeRebuild = z.infer<typeof AiKnowledgeRebuildSchema>
/** `POST /api/v1/ai/consent`: the signer's client echoes the exact text it showed. */
export const AiConsentSignSchema = z.object({ text_version: z.string().min(1), text_hash: z.string().regex(/^[0-9a-f]{64}$/) }).strict()
export type AiConsentSign = z.infer<typeof AiConsentSignSchema>

/** `GET /api/v1/ai/monitoring`: this month's actions and counts, never conversation text. */
export const AiMonitoringSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  totals: z.object({
    messages: z.number().int().nonnegative(), input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(), tool_calls: z.number().int().nonnegative(),
  }).strict(),
  users: z.object({
    items: z.array(z.object({
      user: AiPersonSchema, messages: z.number().int().nonnegative(), tokens: z.number().int().nonnegative(), tool_calls: z.number().int().nonnegative(),
    }).strict()),
    total: z.number().int().nonnegative(),
  }).strict(),
  tools: z.object({
    items: z.array(z.object({ tool_name: z.string(), calls: z.number().int().nonnegative() }).strict()),
    total: z.number().int().nonnegative(),
  }).strict(),
  agents: z.object({
    items: z.array(z.object({ agent: AiAgentKeySchema, calls: z.number().int().nonnegative() }).strict()),
    total: z.number().int().nonnegative(),
  }).strict(),
}).strict()
export type AiMonitoring = z.infer<typeof AiMonitoringSchema>

export const AI_RETENTION_DAYS_MIN = 1
export const AI_RETENTION_DAYS_MAX = 365
export const AI_LEAVER_RETENTION_DAYS_MAX = 365
export const AI_BASE_URL_MAX_LENGTH = 512
/** `GET /api/ai/config` (the AI service's tenant configuration): never the key itself, only whether one is set. */
export const AiTenantConfigSchema = z.object({
  retention_days: z.number().int().min(AI_RETENTION_DAYS_MIN).max(AI_RETENTION_DAYS_MAX),
  /** Days a leaver's conversations are kept after their account is switched off; their notes go at once. */
  leaver_retention_days: z.number().int().min(0).max(AI_LEAVER_RETENTION_DAYS_MAX),
  key: z.object({
    configured: z.boolean(),
    provider: AiProviderNameSchema.nullable(),
    model: AiModelNameSchema.nullable(),
    last4: z.string().max(4).nullable(),
    updated_at: z.iso.datetime({ offset: true }).nullable(),
    /** The endpoint of a provider that takes one (`needs_base_url`); not a secret. */
    base_url: z.string().max(AI_BASE_URL_MAX_LENGTH).nullable(),
  }).strict(),
  platform: z.object({ provider: AiProviderNameSchema, model: AiModelNameSchema }).strict(),
  providers: z.array(z.object({ name: AiProviderNameSchema, needs_api_key: z.boolean(), needs_base_url: z.boolean() }).strict()),
}).strict()
export type AiTenantConfig = z.infer<typeof AiTenantConfigSchema>
export const AiLeaverRetentionPutSchema = z.object({ leaver_retention_days: z.number().int().min(0).max(AI_LEAVER_RETENTION_DAYS_MAX) }).strict()
export type AiLeaverRetentionPut = z.infer<typeof AiLeaverRetentionPutSchema>
export const AiRetentionPutSchema = z.object({ retention_days: z.number().int().min(AI_RETENTION_DAYS_MIN).max(AI_RETENTION_DAYS_MAX) }).strict()
export type AiRetentionPut = z.infer<typeof AiRetentionPutSchema>
/** `base_url` is sent for a provider that needs one and omitted for the rest; the AI service checks the rest of its shape and that it is public. */
export const AiKeyPutSchema = z.object({
  provider: AiProviderNameSchema,
  model: AiModelNameSchema,
  api_key: z.string().min(1).max(512),
  base_url: z.string().max(AI_BASE_URL_MAX_LENGTH).regex(/^https:\/\//i).optional(),
}).strict()
export type AiKeyPut = z.infer<typeof AiKeyPutSchema>

/** The administrator's mode for one tool: `approval` makes even a read wait for the user; `off` removes it. */
export const AiToolModeSchema = z.enum(['on', 'approval', 'off'])
export type AiToolMode = z.infer<typeof AiToolModeSchema>
/** `GET /api/v1/ai/agents`: the agents of the tenant's enabled applications and how the administrator narrowed them. */
export const AiAgentSettingSchema = z.object({
  key: AiAgentKeySchema,
  name: AiTextSchema,
  description: AiTextSchema,
  enabled: z.boolean(),
  read_only: z.boolean(),
  memory: z.boolean(),
  /** The agent never remembers (the help agent): `memory` is false and cannot be switched on. */
  memory_fixed: z.boolean(),
  role_ids: z.array(z.number().int().positive()),
  /** Bumped by every change of the agent or its tools; a save sends the revision it read and a stale one answers 409. */
  revision: z.number().int().nonnegative(),
  tools: z.array(z.object({
    name: z.string(), kind: AiToolKindSchema, description: AiTextSchema, external: z.boolean(), mode: AiToolModeSchema,
  }).strict()),
}).strict()
export type AiAgentSetting = z.infer<typeof AiAgentSettingSchema>
export const AiAgentSettingsSchema = z.object({ items: z.array(AiAgentSettingSchema), total: z.number().int().nonnegative() }).strict()
export type AiAgentSettings = z.infer<typeof AiAgentSettingsSchema>
/** `PATCH /api/v1/ai/agents/{key}`: any of these; settings only narrow what the agent may do. */
export const AiAgentPatchSchema = z.object({
  revision: z.number().int().nonnegative(),
  enabled: z.boolean().optional(),
  read_only: z.boolean().optional(),
  memory: z.boolean().optional(),
  role_ids: z.array(z.number().int().positive()).optional(),
  tools: z.record(z.string(), AiToolModeSchema).optional(),
}).strict().refine(value => Object.keys(value).length > 1, 'nothing to change')
export type AiAgentPatch = z.infer<typeof AiAgentPatchSchema>

export const AI_NOTE_MAX_CHARS = 300
/** `GET /api/ai/memory`: the caller's own notes about their way of working; only they see or delete them. */
export const AiNoteSchema = z.object({ id: z.number().int().positive(), content: z.string().min(1).max(AI_NOTE_MAX_CHARS), created_at: z.iso.datetime({ offset: true }) }).strict()
export type AiNote = z.infer<typeof AiNoteSchema>
export const AiNoteListSchema = z.object({ items: z.array(AiNoteSchema), total: z.number().int().nonnegative() }).strict()
export type AiNoteList = z.infer<typeof AiNoteListSchema>
/** `GET /api/ai/company-memory`: the current company's notes, proposed by agents and used only once approved. */
export const AiCompanyNoteSchema = z.object({
  id: z.number().int().positive(),
  content: z.string().min(1).max(AI_NOTE_MAX_CHARS),
  status: z.enum(['proposed', 'approved']),
  proposed_by: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
}).strict()
export type AiCompanyNote = z.infer<typeof AiCompanyNoteSchema>
export const AiCompanyNoteListSchema = z.object({ items: z.array(AiCompanyNoteSchema), total: z.number().int().nonnegative() }).strict()
export type AiCompanyNoteList = z.infer<typeof AiCompanyNoteListSchema>
