import { z } from 'zod'
import { InboxFlowInteractiveSchema, InboxFlowSubmissionSchema, InboxTemplateFlowButtonSchema, InboxTemplateFlowButtonWriteSchema } from './flows'
import { InboxCommerceContentSchema, InboxMessageCommerceSchema } from './catalog'

export * from './flows'
export * from './catalog'

// Wire shapes of /api/v1/inbox and /api/v1/settings/inbox. Every schema mirrors one
// serializer in odoo-addons/webvue_inbox/serializers exactly (strict objects).

const Id = z.number().int().positive()
const UtcDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
const list = <T extends z.ZodType>(item: T) => z.object({
  items: z.array(item),
  total: z.number().int().nonnegative(),
}).strict()

export const InboxRefSchema = z.object({ id: Id, name: z.string() }).strict()
// A plain list of references: channels an automation manager may target, assignee pickers.
export const InboxRefListSchema = list(InboxRefSchema)

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
  // The customer's answer to the satisfaction survey, null until answered.
  csat: z.object({ score: z.enum(['good', 'neutral', 'bad']), at: UtcDateTime }).strict().nullable(),
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
  'text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contacts', 'interactive', 'template', 'flow_response', 'product', 'product_list', 'catalog_message', 'order', 'unsupported',
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
  InboxFlowInteractiveSchema,
])

export const InboxMessageSchema = z.object({
  id: Id,
  direction: InboxDirectionSchema,
  kind: InboxMessageKindSchema,
  body: z.string(),
  author: InboxRefSchema.nullable(),
  // A sent template: its name and the parts around the rendered body (header media is in attachments).
  template: z.object({
    name: z.string(),
    header_text: z.string().nullable(),
    footer: z.string().nullable(),
    buttons: z.array(z.object({ type: z.string(), text: z.string() }).strict()),
  }).strict().nullable(),
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
  // The customer's completed form, on an inbound flow_response message.
  flow_response: InboxFlowSubmissionSchema.nullable(),
  // Sent by the inbox automation (welcome, away, a rule or the survey), not by an agent.
  automated: z.boolean(),
  // Catalog content sent, a customer's cart or a product inquiry.
  commerce: InboxMessageCommerceSchema.nullable(),
  // The campaign that sent this message, for the thread label.
  campaign: InboxRefSchema.nullable(),
  created_at: UtcDateTime,
}).strict()

export const InboxMessageListSchema = list(InboxMessageSchema)

// An agent file is uploaded first, as base64 JSON like every WebVue attachment (json2, same-origin only), then
// sent with {attachment_id}. Images up to 5 MB, video, audio and documents up to 10 MB (the platform cap).
export const InboxUploadCreateSchema = z.object({
  name: z.string().min(1).max(255),
  mimetype: z.string().min(1).max(128),
  data: z.string().min(1),
}).strict()

const ReplyTo = { reply_to_id: Id.optional() }

// A reply is free text, a file uploaded first through /uploads (with an optional caption), a location or an
// interactive message — all only inside the customer-service window — or an approved template at any time.
// The server answers 422 `invalid` for a free-form reply once the window has closed.
export const InboxReplyCreateSchema = z.union([
  z.object({ body: z.string().min(1).max(4096), ...ReplyTo }).strict(),
  z.object({ attachment_id: Id, caption: z.string().min(1).max(1024).optional(), ...ReplyTo }).strict(),
  z.object({ location: InboxLocationSchema, ...ReplyTo }).strict(),
  z.object({ interactive: InboxInteractiveSchema, ...ReplyTo }).strict(),
  z.object({ commerce: InboxCommerceContentSchema, ...ReplyTo }).strict(),
  z.object({
    template_id: Id,
    params: z.array(z.string().min(1).max(1024)).max(20),
    // The value of a text header's {{1}}, a file uploaded first for a media header, or a location header.
    header_param: z.string().min(1).max(60).optional(),
    header_attachment_id: Id.optional(),
    header_location: InboxLocationSchema.optional(),
    // The url suffix of a url button with a variable, or the code of a copy-code button, by button position.
    button_params: z.array(z.object({ index: z.number().int().min(0).max(9), value: z.string().min(1).max(2000) }).strict()).max(3).optional(),
  }).strict(),
])

// The agent's reaction on a message; an empty string removes it.
export const InboxReactionSchema = z.object({ emoji: z.string().max(16) }).strict()

export const InboxNoteCreateSchema = z.object({ body: z.string().min(1).max(4096) }).strict()

export const InboxContactPatchSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  email: z.email().nullable().optional(),
}).strict()

// Users of the current company who may reply: the assignee picker.
export const InboxAgentListSchema = InboxRefListSchema

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

// ---------------------------------------------------------------- templates
// A WhatsApp message template as Meta reviews it. Variables are positional ({{1}}, {{2}}, ...) and every one
// carries an example, which Meta requires for review. Limits are Meta's.

export const InboxTemplateCategorySchema = z.enum(['marketing', 'utility', 'authentication'])
export const InboxTemplateStatusSchema = z.enum([
  'pending', 'approved', 'rejected', 'paused', 'disabled', 'in_appeal', 'flagged', 'pending_deletion',
])
export const InboxTemplateQualitySchema = z.enum(['green', 'yellow', 'red', 'unknown'])

const PLACEHOLDER = /\{\{([1-9]\d*)\}\}/g
// The highest positional placeholder of `text`, 0 when it has none.
export const templatePlaceholderCount = (text: string) =>
  Math.max(0, ...[...text.matchAll(PLACEHOLDER)].map(match => Number(match[1])))
// Placeholders must run 1..n without gaps, as Meta requires.
const consecutivePlaceholders = (text: string) => {
  const used = new Set([...text.matchAll(PLACEHOLDER)].map(match => Number(match[1])))
  return [...used].every(position => position <= used.size)
}

const TemplateExample = z.string().min(1).max(1024)
const TemplateHeaderMediaKind = z.enum(['image', 'video', 'document'])

const HeaderText = z.object({
  type: z.literal('text'),
  text: z.string().min(1).max(60).refine(text => templatePlaceholderCount(text) <= 1 && consecutivePlaceholders(text), 'a text header holds at most one variable, {{1}}'),
  example: TemplateExample.nullable(),
}).strict().refine(header => (templatePlaceholderCount(header.text) === 1) === (header.example !== null), 'a header variable needs exactly one example')
const HeaderLocation = z.object({ type: z.literal('location') }).strict()

// The header Meta shows above the body. A media header carries a sample file for review (uploaded first).
export const InboxTemplateHeaderSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string(), example: z.string().nullable() }).strict(),
  z.object({ type: TemplateHeaderMediaKind, example_attachment: InboxAttachmentSchema.nullable() }).strict(),
  HeaderLocation,
])
export const InboxTemplateHeaderWriteSchema = z.union([
  HeaderText,
  z.object({ type: TemplateHeaderMediaKind, example_attachment_id: Id }).strict(),
  HeaderLocation,
])

const ButtonText = z.string().min(1).max(25)
// A button as stored, including templates made in WhatsApp Manager, so values are not re-checked against write rules.
export const InboxTemplateButtonSchema = z.union([
  z.object({ type: z.literal('quick_reply'), text: z.string() }).strict(),
  z.object({ type: z.literal('url'), text: z.string(), url: z.string(), example: z.string().nullable() }).strict(),
  z.object({ type: z.literal('phone_number'), text: z.string(), phone_number: z.string() }).strict(),
  z.object({ type: z.literal('copy_code'), example: z.string() }).strict(),
  InboxTemplateFlowButtonSchema,
])

export const InboxTemplateButtonWriteSchema = z.union([
  z.object({ type: z.literal('quick_reply'), text: ButtonText }).strict(),
  // A url may end with one variable, {{1}}, filled per message; its example is then the full example url.
  z.object({
    type: z.literal('url'),
    text: ButtonText,
    url: z.url({ protocol: /^https$/ }).max(2000),
    example: z.url({ protocol: /^https$/ }).max(2000).nullable(),
  }).strict()
    .refine(button => !/\{\{/.test(button.url.replace(/\{\{1\}\}$/, '')), 'a url holds one variable, {{1}}, at its end')
    .refine(button => button.url.endsWith('{{1}}') === (button.example !== null), 'a url variable needs an example'),
  z.object({ type: z.literal('phone_number'), text: ButtonText, phone_number: z.string().regex(/^\+[1-9]\d{6,14}$/) }).strict(),
  // Copies a coupon code given per message; the example is a sample code.
  z.object({ type: z.literal('copy_code'), example: z.string().min(1).max(15) }).strict(),
  InboxTemplateFlowButtonWriteSchema,
])

const byType = (buttons: { type: string }[], type: string) => buttons.filter(button => button.type === type).length
// Quick replies sit together, before or after the other buttons, never interleaved.
const quickRepliesGrouped = (buttons: { type: string }[]) => {
  const runs = buttons.map(button => button.type === 'quick_reply').filter((quick, index, all) => index === 0 || quick !== all[index - 1])
  return runs.length <= 2
}
const TemplateButtons = z.array(InboxTemplateButtonWriteSchema).max(10)
  .refine(buttons => byType(buttons, 'url') <= 2, 'at most two url buttons')
  .refine(buttons => byType(buttons, 'phone_number') <= 1, 'at most one phone button')
  .refine(buttons => byType(buttons, 'copy_code') <= 1, 'at most one copy-code button')
  .refine(buttons => byType(buttons, 'flow') <= 1, 'at most one flow button')
  .refine(quickRepliesGrouped, 'quick replies must be grouped together')

const TemplateName = z.string().regex(/^[a-z0-9_]{1,512}$/)
// Meta language codes: ar, en, en_US, pt_BR, ...
const TemplateLanguage = z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/)
const TemplateBody = z.string().min(1).max(1024).refine(consecutivePlaceholders, 'variables run {{1}}, {{2}}, ... without gaps')

export const InboxTemplateSchema = z.object({
  id: Id,
  name: z.string(),
  language: z.string(),
  category: InboxTemplateCategorySchema,
  status: InboxTemplateStatusSchema,
  // Meta's reason for a rejection, pause or disable; null otherwise.
  status_reason: z.string().nullable(),
  quality: InboxTemplateQualitySchema,
  header: InboxTemplateHeaderSchema.nullable(),
  // Authentication templates carry Meta's fixed body text.
  body: z.string(),
  body_examples: z.array(z.string()),
  footer: z.string().nullable(),
  buttons: z.array(InboxTemplateButtonSchema),
  // Authentication templates only (false and null otherwise).
  add_security_recommendation: z.boolean(),
  code_expiration_minutes: z.number().int().min(1).max(90).nullable(),
  // The label of the button that copies the code (authentication only).
  otp_button_text: z.string().nullable(),
  // Body variables an agent fills when sending.
  param_count: z.number().int().nonnegative(),
  // Meta accepts edits of approved, rejected and paused templates only.
  editable: z.boolean(),
  // False when the template uses a part WebVue cannot fill (named variables, catalog buttons, ...):
  // it is then neither sent nor edited from WebVue.
  supported: z.boolean(),
}).strict()
export const InboxTemplateListSchema = list(InboxTemplateSchema)

// Create or edit a template. Name and language cannot change once created. Marketing and utility templates
// are written in full; an authentication template only chooses Meta's options around its fixed text.
const StandardTemplateWrite = z.object({
  name: TemplateName,
  language: TemplateLanguage,
  category: z.enum(['marketing', 'utility']),
  // Let Meta move the template to the category it judges right instead of rejecting it.
  allow_category_change: z.boolean(),
  header: InboxTemplateHeaderWriteSchema.nullable(),
  body: TemplateBody,
  body_examples: z.array(TemplateExample).max(20),
  footer: z.string().min(1).max(60).nullable(),
  buttons: TemplateButtons,
}).strict().refine(template => template.body_examples.length === templatePlaceholderCount(template.body), 'every body variable needs one example')

const AuthenticationTemplateWrite = z.object({
  name: TemplateName,
  language: TemplateLanguage,
  category: z.literal('authentication'),
  add_security_recommendation: z.boolean(),
  code_expiration_minutes: z.number().int().min(1).max(90).nullable(),
  // The one copy-code button that copies the code.
  otp_button_text: ButtonText,
}).strict()

export const InboxTemplateWriteSchema = z.union([StandardTemplateWrite, AuthenticationTemplateWrite])

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

export const InboxAssignmentPolicySchema = z.enum(['manual', 'round_robin', 'least_open'])

export const InboxSettingsSchema = z.object({
  visibility_policy: InboxVisibilityPolicySchema,
  auto_close_hours: z.number().int().min(0).max(720),
  retention_months: z.number().int().min(1).max(120),
  // Who gets a new unassigned conversation, among its department's members (or all agents without one).
  assignment_policy: InboxAssignmentPolicySchema,
  // Alert agents when a customer has waited this long for a first reply; 0 turns the alert off.
  first_response_alert_minutes: z.number().int().min(0).max(1440),
}).strict()
export const InboxSettingsPatchSchema = InboxSettingsSchema.partial().strict()

// ---------------------------------------------------------------- number health and business profile

export const InboxQualityRatingSchema = z.enum(['green', 'yellow', 'red', 'unknown'])
export const InboxNameStatusSchema = z.enum([
  'approved', 'available_without_review', 'pending_review', 'declined', 'expired', 'none', 'unknown',
])
// The business portfolio's messaging limit per 24 hours (shared by every number of the portfolio).
export const InboxMessagingLimitSchema = z.enum([
  'tier_50', 'tier_250', 'tier_2k', 'tier_10k', 'tier_100k', 'unlimited', 'not_set', 'unknown',
])
export const InboxThroughputLevelSchema = z.enum(['standard', 'high', 'not_applicable', 'unknown'])
export const InboxAccountStateSchema = z.enum(['active', 'restricted', 'scheduled_for_disable', 'disabled'])
const CurrencyCode = z.string().regex(/^[A-Z]{3}$/)

// Meta's last known view of the number and its account; null fields were never reported.
export const InboxChannelHealthSchema = z.object({
  display_phone_number: z.string().regex(/^\d{5,20}$/).nullable(),
  verified_name: z.string().nullable(),
  name_status: InboxNameStatusSchema,
  // A display-name change waiting for Meta's review, and Meta's code when it was rejected.
  requested_name: z.string().nullable(),
  name_rejection_reason: z.string().nullable(),
  quality_rating: InboxQualityRatingSchema,
  messaging_limit: InboxMessagingLimitSchema,
  throughput_level: InboxThroughputLevelSchema,
  code_verified: z.boolean(),
  account_state: InboxAccountStateSchema,
  account_restricted_until: UtcDateTime.nullable(),
  checked_at: UtcDateTime.nullable(),
  // Template analytics is an irreversible opt-in on the business account.
  template_insights_enabled: z.boolean(),
  currency: CurrencyCode.nullable(),
  analytics_synced_at: UtcDateTime.nullable(),
  analytics_error: z.string().nullable(),
}).strict()

export const InboxChannelAlertKindSchema = z.enum([
  'quality_changed', 'messaging_limit_changed', 'throughput_upgraded', 'name_approved', 'name_rejected',
  'name_pending', 'account_restricted', 'account_disabled', 'account_reinstated', 'account_violation',
  'scaling_denied', 'connection_failed',
])
export const InboxAlertSeveritySchema = z.enum(['info', 'warning', 'danger'])

export const InboxChannelAlertSchema = z.object({
  id: Id,
  kind: InboxChannelAlertKindSchema,
  severity: InboxAlertSeveritySchema,
  occurred_at: UtcDateTime,
  quality_rating: InboxQualityRatingSchema.nullable(),
  messaging_limit: InboxMessagingLimitSchema.nullable(),
  previous_messaging_limit: InboxMessagingLimitSchema.nullable(),
  requested_name: z.string().nullable(),
  // Meta's code as received: name rejection reason, restriction or violation type, or account alert type.
  reason: z.string().max(200).nullable(),
  expires_at: UtcDateTime.nullable(),
}).strict()
export const InboxChannelAlertListSchema = list(InboxChannelAlertSchema)

export const InboxBusinessVerticalSchema = z.enum([
  'alcohol', 'apparel', 'auto', 'beauty', 'edu', 'entertain', 'event_plan', 'finance', 'govt', 'grocery', 'health',
  'hotel', 'nonprofit', 'online_gambling', 'otc_drugs', 'other', 'physical_gambling', 'prof_services', 'restaurant',
  'retail', 'travel',
])
const ProfileWebsite = z.string().max(256).regex(/^https?:\/\/\S+$/)

// The WhatsApp business profile, read live from Meta (not stored by WebVue).
export const InboxBusinessProfileSchema = z.object({
  about: z.string().nullable(),
  address: z.string().nullable(),
  description: z.string().nullable(),
  email: z.string().nullable(),
  websites: z.array(z.string()).max(2),
  vertical: InboxBusinessVerticalSchema.nullable(),
  picture_url: z.string().url().nullable(),
}).strict()

// Meta's limits; an omitted field is left as it is, an empty string clears it (about cannot be empty).
export const InboxBusinessProfilePatchSchema = z.object({
  about: z.string().min(1).max(139).optional(),
  address: z.string().max(256).optional(),
  description: z.string().max(512).optional(),
  email: z.union([z.literal(''), z.email().max(128)]).optional(),
  websites: z.array(ProfileWebsite).max(2).optional(),
  vertical: InboxBusinessVerticalSchema.nullable().optional(),
}).strict()

// JPEG or PNG up to 5 MB, base64 like every WebVue upload; sent to Meta only.
export const InboxProfilePictureUploadSchema = z.object({
  name: z.string().min(1).max(255),
  mimetype: z.enum(['image/jpeg', 'image/png']),
  data: z.string().min(1).max(Math.ceil((5 * 1024 * 1024) / 3) * 4),
}).strict()

export const InboxDisplayNameRequestSchema = z.object({ name: z.string().trim().min(3).max(128) }).strict()
// The two-step verification PIN: six digits, never stored or returned.
export const InboxPinSchema = z.object({ pin: z.string().regex(/^\d{6}$/) }).strict()

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
  // The Meta app id: needed only to upload the sample file of a media-header template.
  app_id: z.string().nullable(),
  // Shown to the administrator to paste into the Meta app's webhook settings.
  verify_token: z.string(),
  callback_url: z.string(),
  last_error: z.string().nullable(),
  last_event_at: UtcDateTime.nullable(),
  health: InboxChannelHealthSchema,
}).strict()
export const InboxChannelListSchema = list(InboxChannelSchema)

const AppId = z.string().regex(/^\d{5,32}$/)

export const InboxChannelCreateSchema = z.object({
  name: z.string().min(1).max(128),
  kind: InboxChannelKindSchema,
  department_id: Id.nullable().optional(),
  phone_number_id: z.string().regex(/^\d{5,32}$/),
  business_account_id: z.string().regex(/^\d{5,32}$/),
  access_token: z.string().min(16).max(1024),
  app_secret: z.string().min(16).max(256),
  app_id: AppId.nullable().optional(),
}).strict()

export const InboxChannelPatchSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  department_id: Id.nullable().optional(),
  state: z.literal('disabled').optional(),
  access_token: z.string().min(16).max(1024).optional(),
  app_secret: z.string().min(16).max(256).optional(),
  app_id: AppId.nullable().optional(),
}).strict()

// ---------------------------------------------------------------- automation

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/)
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// Weekly working hours and holidays (a resource calendar on the server). No days means always open.
export const InboxWorkingHoursSchema = z.object({
  timezone: z.string().min(1).max(64),
  // 0 = Monday ... 6 = Sunday, as Odoo counts; several ranges per day are allowed.
  days: z.array(z.object({ weekday: z.number().int().min(0).max(6), from: Clock, to: Clock }).strict()
    .refine(range => range.from < range.to, 'a range ends after it starts')).max(42),
  holidays: z.array(z.object({ name: z.string().min(1).max(128), date_from: IsoDate, date_to: IsoDate }).strict()
    .refine(holiday => holiday.date_from <= holiday.date_to, 'a holiday ends on or after its start')).max(100),
}).strict()
// A department's own hours, or null to follow the company's.
export const InboxDepartmentWorkingHoursSchema = z.object({ working_hours: InboxWorkingHoursSchema.nullable() }).strict()

// What an automatic message says: plain text or an interactive message (buttons or list; a CTA url is allowed too).
export const InboxAutoContentSchema = z.union([
  z.object({ body: z.string().min(1).max(4096) }).strict(),
  z.object({ interactive: InboxInteractiveSchema }).strict(),
  z.object({ commerce: InboxCommerceContentSchema }).strict(),
])

export const InboxChannelAutomationSchema = z.object({
  welcome: z.object({
    enabled: z.boolean(),
    // Also greet a returning customer whose last message is at least this many days old; 0 greets new conversations only.
    idle_days: z.number().int().min(0).max(365),
    content: InboxAutoContentSchema.nullable(),
  }).strict(),
  away: z.object({
    enabled: z.boolean(),
    // At most one away message per conversation in this many hours.
    repeat_hours: z.number().int().min(1).max(168),
    content: InboxAutoContentSchema.nullable(),
  }).strict(),
  csat: z.object({
    enabled: z.boolean(),
    question: z.string().min(1).max(1024),
    good: z.string().min(1).max(20),
    neutral: z.string().min(1).max(20),
    bad: z.string().min(1).max(20),
  }).strict(),
}).strict().refine(
  automation => (!automation.welcome.enabled || automation.welcome.content) && (!automation.away.enabled || automation.away.content),
  'an enabled automatic message needs content',
)

export const InboxRuleMatchKindSchema = z.enum(['any', 'contains', 'exact', 'starts_with', 'option', 'flow', 'order'])
export const InboxRuleHoursSchema = z.enum(['any', 'inside', 'outside'])

const RuleFields = {
  name: z.string().min(1).max(128),
  active: z.boolean(),
  match_kind: InboxRuleMatchKindSchema,
  // Words or phrases for contains / exact / starts_with; matched without case, diacritics or letter-form differences.
  keywords: z.array(z.string().min(1).max(128)).max(50),
  // The interactive option id chosen by the customer, for match_kind option.
  option_id: z.string().min(1).max(200).nullable(),
  hours: InboxRuleHoursSchema,
  // Stop evaluating later rules when this one matches.
  stop: z.boolean(),
  reply: InboxAutoContentSchema.nullable(),
  resolve: z.boolean(),
}

// Keywords go with the text kinds, an option id with option and a form with flow; `any` takes none of them.
const ruleShape = (rule: { match_kind: string, keywords: string[], option_id: string | null, flow_id: number | null }) => {
  const keywords = rule.keywords.length > 0
  const option = rule.option_id !== null
  const flow = rule.flow_id !== null
  if (rule.match_kind === 'option') return option && !keywords && !flow
  if (rule.match_kind === 'flow') return flow && !keywords && !option
  if (['contains', 'exact', 'starts_with'].includes(rule.match_kind)) return keywords && !option && !flow
  return !keywords && !option && !flow
}

export const InboxRuleSchema = z.object({
  id: Id,
  sequence: z.number().int(),
  channel: InboxRefSchema.nullable(),
  ...RuleFields,
  // The form whose submission triggers the rule, for match_kind flow.
  flow: InboxRefSchema.nullable(),
  department: InboxRefSchema.nullable(),
  assignee: InboxRefSchema.nullable(),
  tags: z.array(InboxRefSchema),
  priority: InboxPrioritySchema.nullable(),
}).strict()
export const InboxRuleListSchema = list(InboxRuleSchema)

export const InboxRuleWriteSchema = z.object({
  channel_id: Id.nullable(),
  ...RuleFields,
  flow_id: Id.nullable(),
  department_id: Id.nullable(),
  assignee_id: Id.nullable(),
  tag_ids: z.array(Id).max(20),
  priority: InboxPrioritySchema.nullable(),
}).strict()
  .refine(ruleShape, 'keywords go with contains, exact and starts_with; an option id with option; a form with flow')
  .refine(rule => rule.reply !== null || rule.department_id !== null || rule.assignee_id !== null || rule.tag_ids.length > 0
    || rule.priority !== null || rule.resolve, 'a rule needs at least one action')

export const InboxRuleReorderSchema = z.object({ ids: z.array(Id).min(1).max(500) }).strict()

// Dry run: which rule (if any) a message would trigger, and the automatic message it would get. Nothing is sent.
export const InboxRuleTestSchema = z.object({
  channel_id: Id,
  text: z.string().max(4096).nullable(),
  option_id: z.string().min(1).max(200).nullable(),
  flow_id: Id.nullable(),
  at: UtcDateTime.nullable(),
}).strict()
export const InboxRuleTestResultSchema = z.object({
  inside_hours: z.boolean(),
  // Welcome or away, when the channel would send one before the rules.
  auto_message: z.enum(['welcome', 'away']).nullable(),
  rules: z.array(InboxRefSchema),
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
export type InboxUploadCreate = z.infer<typeof InboxUploadCreateSchema>
export type InboxNoteCreate = z.infer<typeof InboxNoteCreateSchema>
export type InboxContactPatch = z.infer<typeof InboxContactPatchSchema>
export type InboxCannedReply = z.infer<typeof InboxCannedReplySchema>
export type InboxCannedReplyWrite = z.infer<typeof InboxCannedReplyWriteSchema>
export type InboxTemplate = z.infer<typeof InboxTemplateSchema>
export type InboxTemplateCategory = z.infer<typeof InboxTemplateCategorySchema>
export type InboxTemplateStatus = z.infer<typeof InboxTemplateStatusSchema>
export type InboxTemplateQuality = z.infer<typeof InboxTemplateQualitySchema>
export type InboxTemplateHeader = z.infer<typeof InboxTemplateHeaderSchema>
export type InboxTemplateButton = z.infer<typeof InboxTemplateButtonSchema>
export type InboxTemplateButtonWrite = z.infer<typeof InboxTemplateButtonWriteSchema>
export type InboxTemplateWrite = z.infer<typeof InboxTemplateWriteSchema>
export type InboxDepartment = z.infer<typeof InboxDepartmentSchema>
export type InboxDepartmentWrite = z.infer<typeof InboxDepartmentWriteSchema>
export type InboxTag = z.infer<typeof InboxTagSchema>
export type InboxTagWrite = z.infer<typeof InboxTagWriteSchema>
export type InboxSettings = z.infer<typeof InboxSettingsSchema>
export type InboxAssignmentPolicy = z.infer<typeof InboxAssignmentPolicySchema>
export type InboxWorkingHours = z.infer<typeof InboxWorkingHoursSchema>
export type InboxAutoContent = z.infer<typeof InboxAutoContentSchema>
export type InboxChannelAutomation = z.infer<typeof InboxChannelAutomationSchema>
export type InboxRuleMatchKind = z.infer<typeof InboxRuleMatchKindSchema>
export type InboxRule = z.infer<typeof InboxRuleSchema>
export type InboxRuleWrite = z.infer<typeof InboxRuleWriteSchema>
export type InboxRuleTest = z.infer<typeof InboxRuleTestSchema>
export type InboxRuleTestResult = z.infer<typeof InboxRuleTestResultSchema>
export type InboxSettingsPatch = z.infer<typeof InboxSettingsPatchSchema>
export type InboxChannel = z.infer<typeof InboxChannelSchema>
export type InboxChannelCreate = z.infer<typeof InboxChannelCreateSchema>
export type InboxChannelPatch = z.infer<typeof InboxChannelPatchSchema>
export type InboxChannelHealth = z.infer<typeof InboxChannelHealthSchema>
export type InboxQualityRating = z.infer<typeof InboxQualityRatingSchema>
export type InboxNameStatus = z.infer<typeof InboxNameStatusSchema>
export type InboxMessagingLimit = z.infer<typeof InboxMessagingLimitSchema>
export type InboxThroughputLevel = z.infer<typeof InboxThroughputLevelSchema>
export type InboxAccountState = z.infer<typeof InboxAccountStateSchema>
export type InboxChannelAlert = z.infer<typeof InboxChannelAlertSchema>
export type InboxChannelAlertKind = z.infer<typeof InboxChannelAlertKindSchema>
export type InboxBusinessVertical = z.infer<typeof InboxBusinessVerticalSchema>
export type InboxBusinessProfile = z.infer<typeof InboxBusinessProfileSchema>
export type InboxBusinessProfilePatch = z.infer<typeof InboxBusinessProfilePatchSchema>
export type InboxProfilePictureUpload = z.infer<typeof InboxProfilePictureUploadSchema>
export type InboxDisplayNameRequest = z.infer<typeof InboxDisplayNameRequestSchema>
export type InboxPin = z.infer<typeof InboxPinSchema>
