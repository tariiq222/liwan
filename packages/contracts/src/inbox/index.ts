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

// What a message carries. Inbound media, location and contacts arrive from the customer; an agent may send
// text, media, a location, an interactive message or a template.
export const InboxMessageKindSchema = z.enum([
  'text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contacts', 'interactive', 'template', 'unsupported',
])

export const InboxLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().max(1000).nullable(),
  address: z.string().max(1000).nullable(),
}).strict()

const InteractiveText = {
  body: z.string().min(1).max(1024),
  header: z.string().min(1).max(60).nullable(),
  footer: z.string().min(1).max(60).nullable(),
}
const OptionId = z.string().min(1).max(200)

// The WhatsApp interactive messages an agent may send: up to three reply buttons, a list of up to ten
// rows in sections, or one call-to-action URL button. The limits are Meta's.
export const InboxInteractiveSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('buttons'),
    ...InteractiveText,
    buttons: z.array(z.object({ id: OptionId, title: z.string().min(1).max(20) }).strict()).min(1).max(3),
  }).strict(),
  z.object({
    type: z.literal('list'),
    ...InteractiveText,
    button: z.string().min(1).max(20),
    sections: z.array(z.object({
      title: z.string().min(1).max(24).nullable(),
      rows: z.array(z.object({
        id: OptionId,
        title: z.string().min(1).max(24),
        description: z.string().min(1).max(72).nullable(),
      }).strict()).min(1).max(10),
    }).strict()).min(1).max(10)
      .refine(sections => sections.reduce((total, section) => total + section.rows.length, 0) <= 10, 'a list holds at most 10 rows'),
  }).strict(),
  z.object({
    type: z.literal('cta_url'),
    ...InteractiveText,
    display_text: z.string().min(1).max(20),
    url: z.url({ protocol: /^https$/ }),
  }).strict(),
])

export const InboxMessageSchema = z.object({
  id: Id,
  direction: InboxDirectionSchema,
  kind: InboxMessageKindSchema,
  body: z.string(),
  author: InboxRefSchema.nullable(),
  template_name: z.string().nullable(),
  delivery_state: InboxDeliveryStateSchema,
  error: z.string().nullable(),
  attachments: z.array(InboxAttachmentSchema),
  // The message this one answers (WhatsApp context), with a short preview of its text.
  reply_to: z.object({ id: Id, preview: z.string() }).strict().nullable(),
  // One reaction per side: the customer's emoji and the agent's emoji on this message.
  reactions: z.object({ customer: z.string().nullable(), agent: z.string().nullable() }).strict(),
  location: InboxLocationSchema.nullable(),
  // An outbound interactive message as sent; an inbound reply to one carries the chosen option.
  interactive: InboxInteractiveSchema.nullable(),
  selected_option: z.object({ id: z.string(), title: z.string() }).strict().nullable(),
  created_at: UtcDateTime,
}).strict()

export const InboxMessageListSchema = list(InboxMessageSchema)

const ReplyTo = { reply_to_id: Id.optional() }

// A reply is free text, a file uploaded first through /uploads (with an optional caption), a location or an
// interactive message — all only inside the customer-service window — or an approved template at any time.
// The server answers 422 `invalid` for a free-form reply once the window has closed.
export const InboxReplyCreateSchema = z.union([
  z.object({ body: z.string().min(1).max(4096), ...ReplyTo }).strict(),
  z.object({ attachment_id: Id, caption: z.string().min(1).max(1024).optional(), ...ReplyTo }).strict(),
  z.object({ location: InboxLocationSchema, ...ReplyTo }).strict(),
  z.object({ interactive: InboxInteractiveSchema, ...ReplyTo }).strict(),
  z.object({ template_id: Id, params: z.array(z.string().max(1024)).max(20) }).strict(),
])

// The agent's reaction on a message; an empty string removes it.
export const InboxReactionSchema = z.object({ emoji: z.string().max(16) }).strict()

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
export type InboxMessageKind = z.infer<typeof InboxMessageKindSchema>
export type InboxLocation = z.infer<typeof InboxLocationSchema>
export type InboxInteractive = z.infer<typeof InboxInteractiveSchema>
export type InboxReaction = z.infer<typeof InboxReactionSchema>
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
