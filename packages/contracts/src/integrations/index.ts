import { z } from 'zod'

/** `keys`: the tenant types its keys. `oauth`: the tenant authorizes at the provider. `external`: an owning application stores the link, this service only shows its status. */
export const IntegrationAuthSchema = z.enum(['keys', 'oauth', 'external'])
export const IntegrationStateSchema = z.enum(['not_configured', 'pending', 'connected', 'error', 'disabled'])

/** What an application does with a provider account, for example `inbox.whatsapp`. */
export const IntegrationUseSchema = z.object({
  key: z.string().min(1),
  owner: z.string().min(1),
}).strict()

/** A provider the company can connect. Codes come from the server registry, so they are not an enum here. */
export const IntegrationProviderSchema = z.object({
  code: z.string().min(1),
  auth: IntegrationAuthSchema,
  /** Names of the secrets the tenant types. Values are write-only. */
  secrets: z.array(z.string().min(1)),
  /** Names of the secrets the service creates and rotates. A new value shows once. */
  generated_secrets: z.array(z.string().min(1)),
  /** Names of the non-secret fields the tenant types, for example `app_id`. */
  attributes: z.array(z.string().min(1)),
  uses: z.array(IntegrationUseSchema),
  /** `external` only: the settings page that manages the link. */
  settings_path: z.string().startsWith('/').nullable(),
}).strict()

export const IntegrationProviderListSchema = z.object({
  items: z.array(IntegrationProviderSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** One secret of a connection. Only its presence travels; the value never does. */
export const IntegrationSecretSchema = z.object({
  name: z.string().min(1),
  present: z.boolean(),
}).strict()

/** The address a provider calls for one use of the connection. */
export const IntegrationWebhookSchema = z.object({
  use: z.string().min(1),
  url: z.url(),
}).strict()

/** One connected provider account of the company, or the derived status of an `external` link (`id` is null). */
export const IntegrationConnectionSchema = z.object({
  /** `connection:<id>` or `external:<code>`: stable key of the row. */
  ref: z.string().min(1),
  id: z.number().int().positive().nullable(),
  provider: z.string().min(1),
  auth: IntegrationAuthSchema,
  external_id: z.string().min(1).nullable(),
  label: z.string(),
  app_id: z.string().min(1).nullable(),
  state: IntegrationStateSchema,
  status_message: z.string(),
  last_checked: z.string().nullable(),
  token_expires_at: z.string().nullable(),
  secrets: z.array(IntegrationSecretSchema),
  /** Use keys of the applications holding this connection. */
  used_by: z.array(z.string().min(1)),
  webhooks: z.array(IntegrationWebhookSchema),
  settings_path: z.string().startsWith('/').nullable(),
}).strict()

export const IntegrationConnectionListSchema = z.object({
  items: z.array(IntegrationConnectionSchema),
  total: z.number().int().nonnegative(),
}).strict()

const SecretValuesSchema = z.record(z.string().min(1), z.string().trim().min(8).max(1024))
  .refine(values => Object.keys(values).length > 0, { message: 'enter at least one secret' })

/** POST body: connect an account of a `keys` provider. Secrets are write-only. */
export const IntegrationConnectionCreateSchema = z.object({
  provider: z.string().min(1),
  external_id: z.string().trim().min(1).max(64),
  label: z.string().trim().max(128).optional(),
  app_id: z.string().trim().min(1).max(128).optional(),
  secrets: SecretValuesSchema,
}).strict()

/** PATCH body. `pending` asks the server to check the connection again; `disabled` switches it off. */
export const IntegrationConnectionUpdateSchema = z.object({
  label: z.string().trim().max(128).optional(),
  app_id: z.string().trim().min(1).max(128).optional(),
  secrets: SecretValuesSchema.optional(),
  state: z.enum(['pending', 'disabled']).optional(),
}).strict().refine(body => Object.keys(body).length > 0, {
  message: 'label, app_id, secrets or state is required',
})

/** POST body of the OAuth start: the uses to authorize. Authorizing a connected account again refreshes its grant. */
export const IntegrationOAuthStartSchema = z.object({
  uses: z.array(z.string().min(1)).min(1),
}).strict()

export const IntegrationOAuthStartResponseSchema = z.object({
  authorize_url: z.url({ protocol: /^https$/ }),
}).strict()

/** Answer of a rotation: the only time a generated secret travels. */
export const IntegrationSecretRotationSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
}).strict()

/** Error codes the integrations routes answer besides the shared ones. `in_use`: a connection still held by a use, an active sender or a pending message. `provider_error`: the provider refused or could not be reached while reading the account. The messaging codes are listed in `IntegrationMessagingErrorCodeSchema`. */
export const IntegrationErrorCodeSchema = z.enum([
  'invalid', 'forbidden', 'not_found', 'in_use', 'integration_rejected', 'provider_error',
  'invalid_phone', 'no_default_sender', 'sender_unavailable', 'connection_disabled', 'daily_limit_reached', 'body_too_long', 'tenant_read_only',
])

/**
 * Refusals of the messaging service. `invalid_phone`: the number is not valid. `no_default_sender`: the channel has no
 * default sender. `sender_unavailable`: the sender is archived, of another channel or its provider cannot send.
 * `connection_disabled`: the sender's connection is disabled. `daily_limit_reached` (429): the company's daily
 * message limit is used up. `body_too_long`: more than 1600 characters. `tenant_read_only` (403): the tenant may not
 * send while its subscription is not active (the shared suspension code, as liwan_ai answers it).
 */
export const IntegrationMessagingErrorCodeSchema = z.enum([
  'invalid_phone', 'no_default_sender', 'sender_unavailable', 'connection_disabled', 'daily_limit_reached', 'body_too_long', 'tenant_read_only',
])

export const IntegrationSenderChannelSchema = z.enum(['sms', 'whatsapp', 'voice'])
/** `alphanumeric`: an SMS sender ID of up to 11 characters. `number`: an E.164 number of the account. `service`: a messaging service (`MG` + 32 hex). */
export const IntegrationSenderKindSchema = z.enum(['alphanumeric', 'number', 'service'])

/** One sender of the company on one of its connections. DELETE archives it (`active: false`). */
export const IntegrationSenderSchema = z.object({
  id: z.number().int().positive(),
  connection_id: z.number().int().positive(),
  provider: z.string().min(1),
  channel: IntegrationSenderChannelSchema,
  kind: IntegrationSenderKindSchema,
  value: z.string().min(1),
  is_default: z.boolean(),
  active: z.boolean(),
  created_at: z.string().nullable(),
}).strict()

export const IntegrationSenderListSchema = z.object({
  items: z.array(IntegrationSenderSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** POST body: add a sender. The server checks the kind the channel accepts and that a number belongs to the account. */
export const IntegrationSenderCreateSchema = z.object({
  connection_id: z.number().int().positive(),
  channel: IntegrationSenderChannelSchema,
  kind: IntegrationSenderKindSchema,
  value: z.string().trim().min(1).max(64),
  is_default: z.boolean().optional(),
}).strict()

/** PATCH body: only the default flag and the active flag change; anything else is a new sender. */
export const IntegrationSenderUpdateSchema = z.object({
  is_default: z.boolean().optional(),
  active: z.boolean().optional(),
}).strict().refine(body => Object.keys(body).length > 0, {
  message: 'is_default or active is required',
})

/** One phone number of the provider account, with what it can do. */
export const IntegrationAvailableNumberSchema = z.object({
  value: z.string().min(1),
  label: z.string(),
  sms: z.boolean(),
  voice: z.boolean(),
}).strict()

export const IntegrationAvailableNumberListSchema = z.object({
  items: z.array(IntegrationAvailableNumberSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** The company's communication safety settings; defaults apply until the first change. */
export const IntegrationCommunicationSettingsSchema = z.object({
  daily_message_limit: z.number().int().min(1).max(100000),
}).strict()

export const IntegrationCommunicationSettingsUpdateSchema = IntegrationCommunicationSettingsSchema

export const IntegrationMessageChannelSchema = z.enum(['sms', 'whatsapp'])
/** `unconfirmed`: the provider may hold the message; it is never sent again automatically, only by an explicit retry. */
export const IntegrationMessageStateSchema = z.enum(['queued', 'sent', 'delivered', 'undelivered', 'failed', 'unconfirmed'])
/** Who queued a message; applications add their own origins. */
export const IntegrationMessageOriginSchema = z.enum(['test'])
const TemplateSidSchema = z.string().regex(/^HX[0-9a-fA-F]{32}$/)
const TemplateVariablesSchema = z.record(z.string().min(1).max(64), z.string().max(1024))

/** The state of one message, the only shape a test (and a service caller) reads back. `has_receipt` is false when the site has no public HTTPS address, so no delivery receipt can arrive. */
export const IntegrationMessageStateViewSchema = z.object({
  id: z.number().int().positive(),
  channel: IntegrationMessageChannelSchema,
  origin: IntegrationMessageOriginSchema,
  state: IntegrationMessageStateSchema,
  to: z.string().min(1),
  sender_value: z.string().min(1),
  segments: z.number().int().nonnegative(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  has_receipt: z.boolean(),
  created_at: z.string().nullable(),
  sent_at: z.string().nullable(),
  read_at: z.string().nullable(),
}).strict()

/** One row of the message log (`integrations.log.read`). Provider, account and sender are snapshots; the connection and sender ids are null once deleted. */
export const IntegrationMessageSchema = IntegrationMessageStateViewSchema.extend({
  connection_id: z.number().int().positive().nullable(),
  sender_id: z.number().int().positive().nullable(),
  provider: z.string().min(1),
  account_ref: z.string().min(1),
  body: z.string().nullable(),
  content_sid: TemplateSidSchema.nullable(),
  content_variables: TemplateVariablesSchema.nullable(),
  requested_by: z.object({ id: z.number().int().positive(), name: z.string() }).strict().nullable(),
  provider_message_id: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
}).strict()

export const IntegrationMessageListSchema = z.object({
  items: z.array(IntegrationMessageSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** Query of the message log; dates are `YYYY-MM-DD`, `q` matches the recipient number. */
export const IntegrationMessageListQuerySchema = z.object({
  channel: IntegrationMessageChannelSchema.optional(),
  state: IntegrationMessageStateSchema.optional(),
  sender_id: z.number().int().positive().optional(),
  date_from: z.iso.date().optional(),
  date_to: z.iso.date().optional(),
  q: z.string().trim().max(32).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
}).strict()

/** POST body of the messaging test. Without a template the server sends a fixed Arabic text. */
export const IntegrationMessagingTestSchema = z.object({
  sender_id: z.number().int().positive(),
  to: z.string().trim().min(1).max(32),
  content_sid: TemplateSidSchema.optional(),
  content_variables: TemplateVariablesSchema.optional(),
}).strict().refine(body => body.content_variables === undefined || body.content_sid !== undefined, {
  message: 'content_variables need a content_sid',
})

/** One content template of the provider account. */
export const IntegrationMessageTemplateSchema = z.object({
  sid: TemplateSidSchema,
  name: z.string(),
  language: z.string(),
  types: z.array(z.string().min(1)),
  variables: z.array(z.string().min(1)),
}).strict()

export const IntegrationMessageTemplateListSchema = z.object({
  items: z.array(IntegrationMessageTemplateSchema),
  total: z.number().int().nonnegative(),
}).strict()

export type IntegrationAuth = z.infer<typeof IntegrationAuthSchema>
export type IntegrationState = z.infer<typeof IntegrationStateSchema>
export type IntegrationUse = z.infer<typeof IntegrationUseSchema>
export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>
export type IntegrationProviderList = z.infer<typeof IntegrationProviderListSchema>
export type IntegrationSecret = z.infer<typeof IntegrationSecretSchema>
export type IntegrationWebhook = z.infer<typeof IntegrationWebhookSchema>
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>
export type IntegrationConnectionList = z.infer<typeof IntegrationConnectionListSchema>
export type IntegrationConnectionCreate = z.infer<typeof IntegrationConnectionCreateSchema>
export type IntegrationConnectionUpdate = z.infer<typeof IntegrationConnectionUpdateSchema>
export type IntegrationOAuthStart = z.infer<typeof IntegrationOAuthStartSchema>
export type IntegrationOAuthStartResponse = z.infer<typeof IntegrationOAuthStartResponseSchema>
export type IntegrationSecretRotation = z.infer<typeof IntegrationSecretRotationSchema>
export type IntegrationErrorCode = z.infer<typeof IntegrationErrorCodeSchema>
export type IntegrationSenderChannel = z.infer<typeof IntegrationSenderChannelSchema>
export type IntegrationSenderKind = z.infer<typeof IntegrationSenderKindSchema>
export type IntegrationSender = z.infer<typeof IntegrationSenderSchema>
export type IntegrationSenderList = z.infer<typeof IntegrationSenderListSchema>
export type IntegrationSenderCreate = z.infer<typeof IntegrationSenderCreateSchema>
export type IntegrationSenderUpdate = z.infer<typeof IntegrationSenderUpdateSchema>
export type IntegrationAvailableNumber = z.infer<typeof IntegrationAvailableNumberSchema>
export type IntegrationAvailableNumberList = z.infer<typeof IntegrationAvailableNumberListSchema>
export type IntegrationCommunicationSettings = z.infer<typeof IntegrationCommunicationSettingsSchema>
export type IntegrationCommunicationSettingsUpdate = z.infer<typeof IntegrationCommunicationSettingsUpdateSchema>
export type IntegrationMessagingErrorCode = z.infer<typeof IntegrationMessagingErrorCodeSchema>
export type IntegrationMessageChannel = z.infer<typeof IntegrationMessageChannelSchema>
export type IntegrationMessageState = z.infer<typeof IntegrationMessageStateSchema>
export type IntegrationMessageOrigin = z.infer<typeof IntegrationMessageOriginSchema>
export type IntegrationMessageStateView = z.infer<typeof IntegrationMessageStateViewSchema>
export type IntegrationMessage = z.infer<typeof IntegrationMessageSchema>
export type IntegrationMessageList = z.infer<typeof IntegrationMessageListSchema>
export type IntegrationMessageListQuery = z.infer<typeof IntegrationMessageListQuerySchema>
export type IntegrationMessagingTest = z.infer<typeof IntegrationMessagingTestSchema>
export type IntegrationMessageTemplate = z.infer<typeof IntegrationMessageTemplateSchema>
export type IntegrationMessageTemplateList = z.infer<typeof IntegrationMessageTemplateListSchema>
