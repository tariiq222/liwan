import { z } from 'zod'

// Wire shapes of /api/v1/inbox and /api/v1/settings/inbox. Every schema mirrors one
// serializer in odoo-addons/webvue_inbox/serializers exactly (strict objects).

const Id = z.number().int().positive()
const UtcDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
const list = <T extends z.ZodType>(item: T) => z.object({
  items: z.array(item),
  total: z.number().int().nonnegative(),
}).strict()

export const InboxRefSchema = z.object({ id: Id, name: z.string() }).strict()

export const InboxChannelKindSchema = z.enum(['whatsapp'])
export const InboxChannelStateSchema = z.enum(['draft', 'connected', 'error', 'disabled'])
export const InboxConversationStateSchema = z.enum(['open', 'pending', 'resolved', 'closed'])
export const InboxPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent'])
export const InboxDirectionSchema = z.enum(['in', 'out', 'note'])
export const InboxDeliveryStateSchema = z.enum(['received', 'queued', 'sent', 'delivered', 'read', 'failed'])
export const InboxVisibilityPolicySchema = z.enum(['assigned_only', 'department', 'all'])
export const InboxPresetKeySchema = z.enum(['clinic', 'store', 'public_service'])

// ---------------------------------------------------------------- conversations

export const InboxContactSchema = z.object({
  id: Id,
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
}).strict()

export const InboxConversationSchema = z.object({
  id: Id,
  contact: InboxContactSchema,
  channel: z.object({ id: Id, name: z.string(), kind: InboxChannelKindSchema }).strict(),
  department: InboxRefSchema.nullable(),
  assignee: InboxRefSchema.nullable(),
  state: InboxConversationStateSchema,
  priority: InboxPrioritySchema,
  tags: z.array(InboxRefSchema),
  last_message_at: UtcDateTime.nullable(),
  last_message_preview: z.string().nullable(),
  unread: z.boolean(),
  // WhatsApp customer-service window: a free-form reply is accepted until this time;
  // after it only an approved template may be sent. Null when no inbound message exists.
  reply_window_ends_at: UtcDateTime.nullable(),
}).strict()

export const InboxConversationListSchema = list(InboxConversationSchema)

export const InboxConversationDetailSchema = InboxConversationSchema.extend({
  can_reply: z.boolean(),
  can_assign: z.boolean(),
}).strict()

export const InboxConversationPatchSchema = z.object({
  state: InboxConversationStateSchema.optional(),
  priority: InboxPrioritySchema.optional(),
  tag_ids: z.array(Id).optional(),
  assignee_id: Id.nullable().optional(),
  department_id: Id.nullable().optional(),
}).strict()

export const InboxAttachmentSchema = z.object({
  id: Id,
  name: z.string(),
  mimetype: z.string(),
  size: z.number().int().nonnegative(),
}).strict()

export const InboxMessageSchema = z.object({
  id: Id,
  direction: InboxDirectionSchema,
  body: z.string(),
  author: InboxRefSchema.nullable(),
  template_name: z.string().nullable(),
  delivery_state: InboxDeliveryStateSchema,
  error: z.string().nullable(),
  attachments: z.array(InboxAttachmentSchema),
  created_at: UtcDateTime,
}).strict()

export const InboxMessageListSchema = list(InboxMessageSchema)

// A reply is either free text (inside the window) or an approved template with its
// positional body parameters (any time). The server answers 422 `invalid` for free
// text once the window has closed.
export const InboxReplyCreateSchema = z.union([
  z.object({ body: z.string().min(1).max(4096) }).strict(),
  z.object({ template_id: Id, params: z.array(z.string().max(1024)).max(20) }).strict(),
])

export const InboxNoteCreateSchema = z.object({ body: z.string().min(1).max(4096) }).strict()

export const InboxContactPatchSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  email: z.email().nullable().optional(),
}).strict()

// Users of the current company who may reply: the assignee picker.
export const InboxAgentListSchema = list(InboxRefSchema)

export const InboxCannedReplySchema = z.object({
  id: Id,
  shortcut: z.string(),
  body: z.string(),
}).strict()
export const InboxCannedReplyListSchema = list(InboxCannedReplySchema)
export const InboxCannedReplyWriteSchema = z.object({
  shortcut: z.string().min(1).max(32),
  body: z.string().min(1).max(4096),
}).strict()

export const InboxTemplateSchema = z.object({
  id: Id,
  name: z.string(),
  language: z.string(),
  category: z.string(),
  status: z.string(),
  body: z.string(),
  param_count: z.number().int().nonnegative(),
}).strict()
export const InboxTemplateListSchema = list(InboxTemplateSchema)

// ---------------------------------------------------------------- settings

export const InboxDepartmentSchema = z.object({
  id: Id,
  name: z.string(),
  members: z.array(InboxRefSchema),
}).strict()
export const InboxDepartmentListSchema = list(InboxDepartmentSchema)
export const InboxDepartmentWriteSchema = z.object({
  name: z.string().min(1).max(128),
  member_ids: z.array(Id),
}).strict()

export const InboxTagSchema = InboxRefSchema
export const InboxTagListSchema = list(InboxTagSchema)
export const InboxTagWriteSchema = z.object({ name: z.string().min(1).max(64) }).strict()

export const InboxSettingsSchema = z.object({
  visibility_policy: InboxVisibilityPolicySchema,
  auto_close_hours: z.number().int().min(0).max(720),
  retention_months: z.number().int().min(1).max(120),
}).strict()
export const InboxSettingsPatchSchema = InboxSettingsSchema.partial().strict()

export const InboxChannelSchema = z.object({
  id: Id,
  name: z.string(),
  kind: InboxChannelKindSchema,
  state: InboxChannelStateSchema,
  department: InboxRefSchema.nullable(),
  phone_number_id: z.string(),
  business_account_id: z.string(),
  // Secrets are write-only: the API reports only whether one is stored.
  has_access_token: z.boolean(),
  has_app_secret: z.boolean(),
  // Shown to the administrator to paste into the Meta app's webhook settings.
  verify_token: z.string(),
  callback_url: z.string(),
  last_error: z.string().nullable(),
  last_event_at: UtcDateTime.nullable(),
}).strict()
export const InboxChannelListSchema = list(InboxChannelSchema)

export const InboxChannelCreateSchema = z.object({
  name: z.string().min(1).max(128),
  kind: InboxChannelKindSchema,
  department_id: Id.nullable().optional(),
  phone_number_id: z.string().regex(/^\d{5,32}$/),
  business_account_id: z.string().regex(/^\d{5,32}$/),
  access_token: z.string().min(16).max(1024),
  app_secret: z.string().min(16).max(256),
}).strict()

export const InboxChannelPatchSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  department_id: Id.nullable().optional(),
  state: z.enum(['connected', 'disabled']).optional(),
  access_token: z.string().min(16).max(1024).optional(),
  app_secret: z.string().min(16).max(256).optional(),
}).strict()

export type InboxRef = z.infer<typeof InboxRefSchema>
export type InboxChannelKind = z.infer<typeof InboxChannelKindSchema>
export type InboxChannelState = z.infer<typeof InboxChannelStateSchema>
export type InboxConversationState = z.infer<typeof InboxConversationStateSchema>
export type InboxPriority = z.infer<typeof InboxPrioritySchema>
export type InboxDirection = z.infer<typeof InboxDirectionSchema>
export type InboxDeliveryState = z.infer<typeof InboxDeliveryStateSchema>
export type InboxVisibilityPolicy = z.infer<typeof InboxVisibilityPolicySchema>
export type InboxPresetKey = z.infer<typeof InboxPresetKeySchema>
export type InboxContact = z.infer<typeof InboxContactSchema>
export type InboxConversation = z.infer<typeof InboxConversationSchema>
export type InboxConversationList = z.infer<typeof InboxConversationListSchema>
export type InboxConversationDetail = z.infer<typeof InboxConversationDetailSchema>
export type InboxConversationPatch = z.infer<typeof InboxConversationPatchSchema>
export type InboxAttachment = z.infer<typeof InboxAttachmentSchema>
export type InboxMessage = z.infer<typeof InboxMessageSchema>
export type InboxMessageList = z.infer<typeof InboxMessageListSchema>
export type InboxReplyCreate = z.infer<typeof InboxReplyCreateSchema>
export type InboxNoteCreate = z.infer<typeof InboxNoteCreateSchema>
export type InboxContactPatch = z.infer<typeof InboxContactPatchSchema>
export type InboxCannedReply = z.infer<typeof InboxCannedReplySchema>
export type InboxCannedReplyWrite = z.infer<typeof InboxCannedReplyWriteSchema>
export type InboxTemplate = z.infer<typeof InboxTemplateSchema>
export type InboxDepartment = z.infer<typeof InboxDepartmentSchema>
export type InboxDepartmentWrite = z.infer<typeof InboxDepartmentWriteSchema>
export type InboxTag = z.infer<typeof InboxTagSchema>
export type InboxTagWrite = z.infer<typeof InboxTagWriteSchema>
export type InboxSettings = z.infer<typeof InboxSettingsSchema>
export type InboxSettingsPatch = z.infer<typeof InboxSettingsPatchSchema>
export type InboxChannel = z.infer<typeof InboxChannelSchema>
export type InboxChannelCreate = z.infer<typeof InboxChannelCreateSchema>
export type InboxChannelPatch = z.infer<typeof InboxChannelPatchSchema>
