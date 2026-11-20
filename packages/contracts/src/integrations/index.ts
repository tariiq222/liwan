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

/** Error codes the integrations routes answer besides the shared ones. `in_use`: a connection still held by a use or an active sender. `provider_error`: the provider refused or could not be reached while reading the account. */
export const IntegrationErrorCodeSchema = z.enum(['invalid', 'forbidden', 'not_found', 'in_use', 'integration_rejected', 'provider_error'])

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
