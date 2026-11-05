import { z } from 'zod'

// Wire shapes of a TikTok channel's own routes: the OAuth connect, the suggested questions and chat prompts and
// the history import. Every schema mirrors one serializer in odoo-addons/liwan_inbox/serializers/tiktok.py or one
// body of controllers/tiktok_oauth.py and controllers/tiktok_settings.py exactly (strict objects). Limits are
// TikTok's.

const Id = z.number().int().positive()
const UtcDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
const Count = z.number().int().nonnegative()
const list = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), total: Count }).strict()
const Sequence = z.number().int().min(0).max(1000)
const QUESTION_MAX = 80
const ANSWER_MAX = 200
const PROMPT_TITLE_MAX = 18
const PROMPT_CONTENT_MAX = 150
export const INBOX_TIKTOK_LIMITS = {
  questions: 3,
  prompts: 6,
  question: QUESTION_MAX,
  answer: ANSWER_MAX,
  promptTitle: PROMPT_TITLE_MAX,
  promptContent: PROMPT_CONTENT_MAX,
} as const

export const InboxTikTokShortcutKindSchema = z.enum(['question', 'prompt'])
export const InboxTikTokAuditSchema = z.enum(['draft', 'reviewing', 'approved', 'rejected'])

// ---------------------------------------------------------------- connect

// A new channel names itself; reconnecting one names its id and keeps the stored name unless a new one is given.
export const InboxTikTokConnectSchema = z.object({
  channel_id: Id.optional(),
  name: z.string().min(1).max(128).optional(),
  department_id: Id.nullable().optional(),
}).strict().refine(
  value => value.channel_id !== undefined || value.name !== undefined,
  { message: 'name is required to connect a new TikTok channel', path: ['name'] },
)

// The account page the browser is sent to; the callback creates the channel.
export const InboxTikTokConnectResponseSchema = z.object({
  authorize_url: z.url({ protocol: /^https$/ }).max(4000),
}).strict()

// ---------------------------------------------------------------- suggested questions and chat prompts

export const InboxTikTokShortcutSchema = z.object({
  id: Id,
  kind: InboxTikTokShortcutKindSchema,
  sequence: z.number().int(),
  // A suggested question carries question and answer; a chat prompt carries title and content.
  question: z.string().nullable(),
  answer: z.string().nullable(),
  title: z.string().nullable(),
  content: z.string().nullable(),
  // TikTok's own id of the item, none until TikTok accepted the create.
  provider_id: z.string().nullable(),
  audit: InboxTikTokAuditSchema,
  sync_error: z.string().nullable(),
}).strict()
export const InboxTikTokShortcutListSchema = list(InboxTikTokShortcutSchema)

// Exactly the fields of the kind: the controller refuses a question with a title, and the other way round.
export const InboxTikTokShortcutCreateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('question'),
    question: z.string().min(1).max(QUESTION_MAX),
    answer: z.string().min(1).max(ANSWER_MAX),
    sequence: Sequence.optional(),
  }).strict(),
  z.object({
    kind: z.literal('prompt'),
    title: z.string().min(1).max(PROMPT_TITLE_MAX),
    content: z.string().min(1).max(PROMPT_CONTENT_MAX),
    sequence: Sequence.optional(),
  }).strict(),
])

// A patch names at least one field; the row's kind decides which content fields it accepts.
export const InboxTikTokShortcutPatchSchema = z.object({
  sequence: Sequence.optional(),
  question: z.string().min(1).max(QUESTION_MAX).optional(),
  answer: z.string().min(1).max(ANSWER_MAX).optional(),
  title: z.string().min(1).max(PROMPT_TITLE_MAX).optional(),
  content: z.string().min(1).max(PROMPT_CONTENT_MAX).optional(),
}).strict().refine(value => Object.keys(value).length > 0, { message: 'no fields to update' })

// Switching a kind on or off: enabling recreates every stored item of that kind at TikTok.
export const InboxTikTokShortcutEnableSchema = z.object({
  kind: InboxTikTokShortcutKindSchema,
  enabled: z.boolean(),
}).strict()
export const InboxTikTokShortcutEnableResultSchema = z.object({
  kind: InboxTikTokShortcutKindSchema,
  enabled: z.boolean(),
  items: z.array(InboxTikTokShortcutSchema),
  total: Count,
}).strict()

// ---------------------------------------------------------------- history import

export const InboxTikTokSyncStateSchema = z.enum(['queued', 'running', 'done', 'failed'])
// SINGLE conversations, then STRANGER ones, then their messages.
export const InboxTikTokSyncPhaseSchema = z.enum(['single', 'stranger', 'messages'])

export const InboxTikTokSyncSchema = z.object({
  id: Id,
  state: InboxTikTokSyncStateSchema,
  phase: InboxTikTokSyncPhaseSchema,
  conversations_count: Count,
  messages_count: Count,
  error: z.string().nullable(),
  started_at: UtcDateTime.nullable(),
  finished_at: UtcDateTime.nullable(),
  created_at: UtcDateTime,
}).strict()

// GET answers the latest job (null before the first one); POST answers the queued job with 201.
export const InboxTikTokSyncAnswerSchema = z.object({ job: InboxTikTokSyncSchema.nullable() }).strict()

export type InboxTikTokShortcutKind = z.infer<typeof InboxTikTokShortcutKindSchema>
export type InboxTikTokAudit = z.infer<typeof InboxTikTokAuditSchema>
export type InboxTikTokConnect = z.infer<typeof InboxTikTokConnectSchema>
export type InboxTikTokConnectResponse = z.infer<typeof InboxTikTokConnectResponseSchema>
export type InboxTikTokShortcut = z.infer<typeof InboxTikTokShortcutSchema>
export type InboxTikTokShortcutList = z.infer<typeof InboxTikTokShortcutListSchema>
export type InboxTikTokShortcutCreate = z.infer<typeof InboxTikTokShortcutCreateSchema>
export type InboxTikTokShortcutPatch = z.infer<typeof InboxTikTokShortcutPatchSchema>
export type InboxTikTokShortcutEnable = z.infer<typeof InboxTikTokShortcutEnableSchema>
export type InboxTikTokShortcutEnableResult = z.infer<typeof InboxTikTokShortcutEnableResultSchema>
export type InboxTikTokSync = z.infer<typeof InboxTikTokSyncSchema>
export type InboxTikTokSyncAnswer = z.infer<typeof InboxTikTokSyncAnswerSchema>
