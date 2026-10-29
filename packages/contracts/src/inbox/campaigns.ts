import { z } from 'zod'
import {
  InboxAttachmentSchema,
  InboxRefSchema,
  InboxTemplateCategorySchema,
  InboxMessagingLimitSchema,
  InboxQualityRatingSchema,
} from './index'

// Wire shapes of the campaign routes of /api/v1/inbox (audiences, campaigns, recipients, contact consent and import,
// channel sending health) and /api/v1/settings/inbox/campaigns. Every schema mirrors one serializer in
// odoo-addons/webvue_inbox/serializers/campaigns.py exactly (strict objects).

const Id = z.number().int().positive()
const UtcDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
const Count = z.number().int().nonnegative()
const list = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), total: Count }).strict()
const Note = z.string().min(1).max(256)
const Keyword = z.string().min(1).max(64)
const DailyCap = z.number().int().min(0).max(1_000_000)
const ActiveWithinDays = z.number().int().min(0).max(3650)
const NO_FIELDS = 'no fields to update'
const hasFields = (value: object) => Object.keys(value).length > 0

// ---------------------------------------------------------------- consent and segments of a contact

export const InboxConsentStateSchema = z.enum(['unknown', 'opted_in', 'opted_out'])
export const InboxConsentSourceSchema = z.enum(['agent', 'import', 'keyword', 'whatsapp', 'delivery_error'])

export const InboxConsentEventSchema = z.object({
  state: z.enum(['opted_in', 'opted_out']),
  source: InboxConsentSourceSchema,
  // The proof of an opt-in (where and how it was given), or why the customer was opted out.
  note: z.string().nullable(),
  author: InboxRefSchema.nullable(),
  at: UtcDateTime,
}).strict()

export const InboxContactMarketingSchema = z.object({
  contact_id: Id,
  consent: InboxConsentStateSchema,
  consent_at: UtcDateTime.nullable(),
  consent_source: InboxConsentSourceSchema.nullable(),
  tags: z.array(InboxRefSchema),
  // Newest first.
  history: z.array(InboxConsentEventSchema).max(20),
}).strict()

// An agent records an opt-in only with its proof; an opt-out needs no reason.
const ConsentWriteSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('opted_in'), note: Note }).strict(),
  z.object({ state: z.literal('opted_out'), note: Note.optional() }).strict(),
])

export const InboxContactMarketingPatchSchema = z.object({
  consent: ConsentWriteSchema.optional(),
  tag_ids: z.array(Id).max(50).optional(),
}).strict().refine(hasFields, { message: NO_FIELDS })

// A CSV file (base64 JSON like every WebVue upload): header `phone` required, `name` and `tags` (existing tag names
// separated by `;`) optional, at most 10,000 rows. `tag_ids` are added to every row; an import never overrides an
// opt-out.
export const InboxContactImportSchema = z.object({
  name: z.string().min(1).max(255),
  data: z.string().min(1).max(2_800_000),
  tag_ids: z.array(Id).max(10),
  consent: z.enum(['unknown', 'opted_in']),
  consent_note: Note.optional(),
}).strict().refine(value => value.consent !== 'opted_in' || value.consent_note !== undefined, {
  message: 'consent_note is required for an opted_in import',
  path: ['consent_note'],
})

export const InboxContactImportResultSchema = z.object({
  created: Count,
  updated: Count,
  skipped: Count,
  errors: z.array(z.object({ line: z.number().int().positive(), message: z.string() }).strict()).max(50),
}).strict()

// ---------------------------------------------------------------- audiences

export const InboxAudienceTagMatchSchema = z.enum(['any', 'all'])

export const InboxAudienceSchema = z.object({
  id: Id,
  name: z.string(),
  // No tags: every contact of the company.
  tags: z.array(InboxRefSchema),
  tag_match: InboxAudienceTagMatchSchema,
  exclude_tags: z.array(InboxRefSchema),
  // Only contacts with an inbound message in this many days; 0 = any.
  active_within_days: ActiveWithinDays,
  // Counted live: every matching contact, and those a campaign may message under the consent policy.
  contact_count: Count,
  reachable_count: Count,
  created_at: UtcDateTime,
}).strict()
export const InboxAudienceListSchema = list(InboxAudienceSchema)

const AudienceFields = {
  name: z.string().min(1).max(128),
  tag_ids: z.array(Id).max(50),
  tag_match: InboxAudienceTagMatchSchema,
  exclude_tag_ids: z.array(Id).max(50),
  active_within_days: ActiveWithinDays,
}
export const InboxAudienceWriteSchema = z.object(AudienceFields).strict()
export const InboxAudiencePatchSchema = z.object(AudienceFields).partial().strict().refine(hasFields, { message: NO_FIELDS })

export const InboxAudienceMemberSchema = z.object({
  id: Id,
  name: z.string(),
  phone: z.string().nullable(),
  consent: InboxConsentStateSchema,
  tags: z.array(InboxRefSchema),
}).strict()
export const InboxAudienceMemberListSchema = list(InboxAudienceMemberSchema)

// ---------------------------------------------------------------- channel sending health

export const InboxMarketingApiSchema = z.enum(['cloud_api', 'marketing_messages'])
export const InboxMarketingOnboardingSchema = z.enum(['not_started', 'eligible', 'onboarded', 'unknown'])

export const InboxChannelSendingSchema = z.object({
  channel_id: Id,
  // Meta's limit of unique customers messaged outside a service window per rolling 24 hours (shared by the
  // business portfolio's numbers).
  messaging_limit: InboxMessagingLimitSchema,
  quality_rating: InboxQualityRatingSchema,
  // Unique customers messaged outside a service window in the last 24 hours, over every channel of the business account.
  used_24h: Count,
  // null when the limit is unlimited.
  remaining_24h: Count.nullable(),
  marketing_api: InboxMarketingApiSchema,
  marketing_onboarding: InboxMarketingOnboardingSchema,
  checked_at: UtcDateTime.nullable(),
}).strict()
export const InboxChannelSendingPatchSchema = z.object({ marketing_api: InboxMarketingApiSchema }).strict()

// ---------------------------------------------------------------- settings

export const InboxConsentPolicySchema = z.enum(['opted_in_only', 'not_opted_out'])

export const InboxCampaignSettingsSchema = z.object({
  // Who a campaign may message: only recorded opt-ins, or everyone who has not opted out.
  consent_policy: InboxConsentPolicySchema,
  // Turns local numbers of an import (leading 0) into international ones; null = imports need international numbers.
  default_country_code: z.string().regex(/^[1-9]\d{0,2}$/).nullable(),
  // A customer's message equal to a stop or start keyword (normalized) records the opt-out or the opt-in again.
  keyword_opt_out: z.boolean(),
  stop_keywords: z.array(Keyword).max(30),
  start_keywords: z.array(Keyword).max(30),
  // The confirmation sent back; null sends none.
  stop_reply: z.string().min(1).max(1024).nullable(),
  start_reply: z.string().min(1).max(1024).nullable(),
  // The daily cap a new campaign starts with; 0 = only Meta's messaging limit.
  default_daily_cap: DailyCap,
}).strict()
export const InboxCampaignSettingsPatchSchema = InboxCampaignSettingsSchema.partial().strict()

// ---------------------------------------------------------------- campaigns

export const InboxCampaignStateSchema = z.enum(['draft', 'scheduled', 'running', 'paused', 'done', 'cancelled'])
export const InboxCampaignPauseReasonSchema = z.enum([
  'manual', 'template_unavailable', 'account_restricted', 'payment', 'token', 'channel_disabled',
  'messages_limit', 'recipients_limit',
])
// Why a running or scheduled campaign is not sending right now.
export const InboxCampaignWaitingSchema = z.enum(['schedule', 'working_hours', 'daily_cap', 'messaging_limit'])
export const InboxCampaignParamLocationSchema = z.enum(['header', 'body', 'button'])
export const InboxCampaignParamSourceSchema = z.enum([
  'static', 'contact_name', 'contact_first_name', 'contact_phone', 'contact_email',
])

// One template placeholder: body {{n}} (position n), the header's {{1}} (position 1) or a url-suffix / copy-code
// button (position = button index). `value` is the static text, or the fallback for an empty contact field
// (a recipient with neither is skipped as missing_param).
export const InboxCampaignParamSchema = z.object({
  location: InboxCampaignParamLocationSchema,
  position: z.number().int().min(0).max(20),
  source: InboxCampaignParamSourceSchema,
  value: z.string().min(1).max(1024).nullable(),
}).strict().refine(param => param.source !== 'static' || param.value !== null, {
  message: 'a static parameter needs a value',
  path: ['value'],
})

// Recipients by current state (exclusive buckets: `sent` = sent, not yet delivered), plus replies, unsubscribes and
// messages Meta holds for a template quality check.
export const InboxCampaignStatsSchema = z.object({
  total: Count,
  pending: Count,
  skipped: Count,
  queued: Count,
  sent: Count,
  delivered: Count,
  read: Count,
  failed: Count,
  replied: Count,
  unsubscribed: Count,
  held: Count,
}).strict()

export const InboxCampaignSchema = z.object({
  id: Id,
  name: z.string(),
  state: InboxCampaignStateSchema,
  pause_reason: InboxCampaignPauseReasonSchema.nullable(),
  // Meta's message behind an automatic pause.
  pause_detail: z.string().nullable(),
  waiting: InboxCampaignWaitingSchema.nullable(),
  channel: InboxRefSchema,
  // null only for a draft whose template was deleted.
  template: z.object({
    id: Id,
    name: z.string(),
    language: z.string(),
    category: InboxTemplateCategorySchema,
  }).strict().nullable(),
  audience: InboxRefSchema,
  params: z.array(InboxCampaignParamSchema),
  header_attachment: InboxAttachmentSchema.nullable(),
  scheduled_at: UtcDateTime.nullable(),
  send_within_hours: z.boolean(),
  daily_cap: DailyCap,
  launched_at: UtcDateTime.nullable(),
  launched_by: InboxRefSchema.nullable(),
  completed_at: UtcDateTime.nullable(),
  stats: InboxCampaignStatsSchema,
  can_edit: z.boolean(),
  can_delete: z.boolean(),
  created_at: UtcDateTime,
}).strict()
export const InboxCampaignListSchema = list(InboxCampaignSchema)

const CampaignFields = {
  name: z.string().min(1).max(128),
  channel_id: Id,
  template_id: Id,
  audience_id: Id,
  params: z.array(InboxCampaignParamSchema).max(25),
  // A file uploaded first through /campaigns/uploads, for a media-header template.
  header_attachment_id: Id.nullable(),
  // null sends on launch.
  scheduled_at: UtcDateTime.nullable(),
  send_within_hours: z.boolean(),
  daily_cap: DailyCap,
}
export const InboxCampaignWriteSchema = z.object(CampaignFields).strict()
export const InboxCampaignPatchSchema = z.object(CampaignFields).partial().strict().refine(hasFields, { message: NO_FIELDS })

export const InboxCampaignPreviewRequestSchema = z.object({
  template_id: Id,
  params: z.array(InboxCampaignParamSchema).max(25),
  // The sample contact; omitted renders the fallbacks and static values only.
  contact_id: Id.optional(),
}).strict()

export const InboxCampaignPreviewSchema = z.object({
  contact: InboxRefSchema.nullable(),
  header_text: z.string().nullable(),
  body: z.string(),
  footer: z.string().nullable(),
  buttons: z.array(z.object({ type: z.string(), text: z.string() }).strict()),
  // Placeholders without a mapping, or without a value for this contact.
  missing: z.array(z.object({ location: InboxCampaignParamLocationSchema, position: z.number().int().min(0) }).strict()),
}).strict()

export const InboxCampaignTestSendSchema = z.object({ contact_id: Id }).strict()
export const InboxCampaignTestResultSchema = z.object({ conversation_id: Id, message_id: Id }).strict()

// ---------------------------------------------------------------- recipients

export const InboxRecipientStateSchema = z.enum(['pending', 'skipped', 'queued', 'sent', 'delivered', 'read', 'failed'])
export const InboxRecipientSkipReasonSchema = z.enum([
  'opted_out', 'no_consent', 'duplicate_number', 'invalid_number', 'missing_param', 'cancelled',
])
export const InboxRecipientFailureSchema = z.enum([
  'frequency_capped', 'marketing_opt_out', 'not_on_whatsapp', 'template_unavailable', 'invalid_params',
  'experiment', 'account_restricted', 'other',
])

export const InboxCampaignRecipientSchema = z.object({
  id: Id,
  contact: z.object({ id: Id, name: z.string(), phone: z.string().nullable() }).strict(),
  state: InboxRecipientStateSchema,
  skip_reason: InboxRecipientSkipReasonSchema.nullable(),
  failure: InboxRecipientFailureSchema.nullable(),
  // Meta's error code and title of a failure.
  error_code: z.number().int().nullable(),
  error: z.string().nullable(),
  conversation_id: Id.nullable(),
  sent_at: UtcDateTime.nullable(),
  replied_at: UtcDateTime.nullable(),
  unsubscribed_at: UtcDateTime.nullable(),
  // A frequency-capped failure at least 24 hours old may be sent again (POST /campaigns/<id>/retry).
  can_retry: z.boolean(),
}).strict()
export const InboxCampaignRecipientListSchema = list(InboxCampaignRecipientSchema)

export type InboxConsentState = z.infer<typeof InboxConsentStateSchema>
export type InboxConsentSource = z.infer<typeof InboxConsentSourceSchema>
export type InboxConsentEvent = z.infer<typeof InboxConsentEventSchema>
export type InboxContactMarketing = z.infer<typeof InboxContactMarketingSchema>
export type InboxContactMarketingPatch = z.infer<typeof InboxContactMarketingPatchSchema>
export type InboxContactImport = z.infer<typeof InboxContactImportSchema>
export type InboxContactImportResult = z.infer<typeof InboxContactImportResultSchema>
export type InboxAudienceTagMatch = z.infer<typeof InboxAudienceTagMatchSchema>
export type InboxAudience = z.infer<typeof InboxAudienceSchema>
export type InboxAudienceList = z.infer<typeof InboxAudienceListSchema>
export type InboxAudienceWrite = z.infer<typeof InboxAudienceWriteSchema>
export type InboxAudiencePatch = z.infer<typeof InboxAudiencePatchSchema>
export type InboxAudienceMember = z.infer<typeof InboxAudienceMemberSchema>
export type InboxAudienceMemberList = z.infer<typeof InboxAudienceMemberListSchema>
export type InboxMarketingApi = z.infer<typeof InboxMarketingApiSchema>
export type InboxMarketingOnboarding = z.infer<typeof InboxMarketingOnboardingSchema>
export type InboxChannelSending = z.infer<typeof InboxChannelSendingSchema>
export type InboxChannelSendingPatch = z.infer<typeof InboxChannelSendingPatchSchema>
export type InboxConsentPolicy = z.infer<typeof InboxConsentPolicySchema>
export type InboxCampaignSettings = z.infer<typeof InboxCampaignSettingsSchema>
export type InboxCampaignSettingsPatch = z.infer<typeof InboxCampaignSettingsPatchSchema>
export type InboxCampaignState = z.infer<typeof InboxCampaignStateSchema>
export type InboxCampaignPauseReason = z.infer<typeof InboxCampaignPauseReasonSchema>
export type InboxCampaignWaiting = z.infer<typeof InboxCampaignWaitingSchema>
export type InboxCampaignParamLocation = z.infer<typeof InboxCampaignParamLocationSchema>
export type InboxCampaignParamSource = z.infer<typeof InboxCampaignParamSourceSchema>
export type InboxCampaignParam = z.infer<typeof InboxCampaignParamSchema>
export type InboxCampaignStats = z.infer<typeof InboxCampaignStatsSchema>
export type InboxCampaign = z.infer<typeof InboxCampaignSchema>
export type InboxCampaignList = z.infer<typeof InboxCampaignListSchema>
export type InboxCampaignWrite = z.infer<typeof InboxCampaignWriteSchema>
export type InboxCampaignPatch = z.infer<typeof InboxCampaignPatchSchema>
export type InboxCampaignPreviewRequest = z.infer<typeof InboxCampaignPreviewRequestSchema>
export type InboxCampaignPreview = z.infer<typeof InboxCampaignPreviewSchema>
export type InboxCampaignTestSend = z.infer<typeof InboxCampaignTestSendSchema>
export type InboxCampaignTestResult = z.infer<typeof InboxCampaignTestResultSchema>
export type InboxRecipientState = z.infer<typeof InboxRecipientStateSchema>
export type InboxRecipientSkipReason = z.infer<typeof InboxRecipientSkipReasonSchema>
export type InboxRecipientFailure = z.infer<typeof InboxRecipientFailureSchema>
export type InboxCampaignRecipient = z.infer<typeof InboxCampaignRecipientSchema>
export type InboxCampaignRecipientList = z.infer<typeof InboxCampaignRecipientListSchema>
