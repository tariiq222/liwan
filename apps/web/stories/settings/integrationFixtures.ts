import {
  IntegrationAvailableNumberListSchema,
  IntegrationCommunicationSettingsSchema,
  IntegrationMessageListSchema,
  IntegrationMessageSchema,
  IntegrationMessageStateViewSchema,
  IntegrationConnectionListSchema,
  IntegrationConnectionSchema,
  IntegrationProviderListSchema,
  IntegrationSenderListSchema,
} from '@liwan/contracts'

export const providers = IntegrationProviderListSchema.parse({
  items: [
    { code: 'meta', auth: 'keys', secrets: ['access_token', 'app_secret'], generated_secrets: ['verify_token'], attributes: ['app_id'], uses: [{ key: 'inbox.whatsapp', owner: 'liwan_inbox' }], settings_path: null },
    { code: 'tiktok', auth: 'oauth', secrets: [], generated_secrets: [], attributes: [], uses: [{ key: 'inbox.tiktok', owner: 'liwan_inbox' }], settings_path: null },
    { code: 'paymob', auth: 'external', secrets: [], generated_secrets: [], attributes: [], uses: [], settings_path: '/settings/apps/payments#providers' },
    { code: 'twilio', auth: 'keys', secrets: ['auth_token'], generated_secrets: [], attributes: [], uses: [{ key: 'twilio.messaging', owner: 'liwan_integrations_sa' }], settings_path: null },
  ],
  total: 4,
})

export const meta = IntegrationConnectionSchema.parse({
  ref: 'connection:1', id: 1, provider: 'meta', auth: 'keys', external_id: '1029384756', label: 'متجر الورد', app_id: '555',
  state: 'connected', status_message: '', last_checked: '2030-01-15T10:30:00Z', token_expires_at: null,
  secrets: [{ name: 'access_token', present: true }, { name: 'app_secret', present: true }, { name: 'verify_token', present: true }],
  used_by: ['inbox.whatsapp'],
  webhooks: [{ use: 'inbox.whatsapp', url: 'https://app.example.com/api/v1/inbox/hooks/whatsapp' }],
  settings_path: null,
})

export const tiktok = IntegrationConnectionSchema.parse({
  ref: 'connection:2', id: 2, provider: 'tiktok', auth: 'oauth', external_id: 'open-id-77', label: 'liwan.shop', app_id: null,
  state: 'error', status_message: 'انتهت صلاحية الربط. أعد الربط.', last_checked: '2030-01-15T09:00:00Z', token_expires_at: '2030-01-14T09:00:00Z',
  secrets: [], used_by: ['inbox.tiktok'], webhooks: [], settings_path: null,
})

export const zatca = IntegrationConnectionSchema.parse({
  ref: 'external:zatca', id: null, provider: 'zatca', auth: 'external', external_id: null, label: '', app_id: null,
  state: 'not_configured', status_message: '', last_checked: null, token_expires_at: null, secrets: [], used_by: [], webhooks: [],
  settings_path: '/settings/apps/finance#zatca',
})

export const connections = IntegrationConnectionListSchema.parse({ items: [meta, tiktok, zatca], total: 3 })

export const twilio = IntegrationConnectionSchema.parse({
  ref: 'connection:3', id: 3, provider: 'twilio', auth: 'keys', external_id: 'ACtwiliotestaccount', label: 'رسائل المتجر', app_id: null,
  state: 'connected', status_message: '', last_checked: '2030-01-15T10:30:00Z', token_expires_at: null,
  secrets: [{ name: 'auth_token', present: true }], used_by: [], webhooks: [], settings_path: null,
})
export const twilioProvider = providers.items[3]!

export const senders = IntegrationSenderListSchema.parse({
  items: [
    { id: 11, connection_id: 3, provider: 'twilio', channel: 'sms', kind: 'number', value: '+966500000001', is_default: true, active: true, created_at: '2030-01-10T08:00:00Z' },
    { id: 12, connection_id: 3, provider: 'twilio', channel: 'sms', kind: 'alphanumeric', value: 'Liwan', is_default: false, active: true, created_at: '2030-01-11T08:00:00Z' },
    { id: 13, connection_id: 3, provider: 'twilio', channel: 'whatsapp', kind: 'number', value: '+14155238886', is_default: true, active: true, created_at: '2030-01-12T08:00:00Z' },
  ],
  total: 3,
})
export const archivedSenders = IntegrationSenderListSchema.parse({
  items: [{ id: 14, connection_id: 3, provider: 'twilio', channel: 'sms', kind: 'service', value: `MG${'a'.repeat(32)}`, is_default: false, active: false, created_at: '2030-01-05T08:00:00Z' }],
  total: 1,
})
export const emptySenders = IntegrationSenderListSchema.parse({ items: [], total: 0 })
export const smsOnlySenders = IntegrationSenderListSchema.parse({ items: [senders.items[0]!], total: 1 })

export const availableNumbers = IntegrationAvailableNumberListSchema.parse({
  items: [
    { value: '+966500000001', label: 'خط المتجر', sms: true, voice: true },
    { value: '+966500000002', label: '', sms: true, voice: false },
    { value: '+966500000003', label: 'خط صوت فقط', sms: false, voice: true },
  ],
  total: 3,
})

export const settings = IntegrationCommunicationSettingsSchema.parse({ daily_message_limit: 1000 })

const messageBase = { connection_id: 3, sender_id: 11, provider: 'twilio', sender_value: '+966500000001', channel: 'sms', body: 'رسالة تجربة من ليوان.', content_sid: null, origin: 'test', read_at: null, segments: 1, error_code: null, error_message: null, has_receipt: true, sent_at: '2030-01-15T10:30:05Z', created_at: '2030-01-15T10:30:00Z', account_ref: 'ACtwiliotestaccount', content_variables: null, requested_by: { id: 7, name: 'سارة' }, provider_message_id: 'SMtwiliotestmessage', attempts: 1 }
const message = (overrides: Record<string, unknown>) => IntegrationMessageSchema.parse({ ...messageBase, ...overrides })

export const messageQueued = message({ id: 1, to: '+966555000001', state: 'queued', sent_at: null })
export const messageSent = message({ id: 2, to: '+966555000002', state: 'sent' })
export const messageSentNoReceipt = message({ id: 3, to: '+966555000003', state: 'sent', has_receipt: false })
export const messageDelivered = message({ id: 4, to: '+966555000004', state: 'delivered' })
export const messageUndelivered = message({ id: 5, to: '+966555000005', state: 'undelivered', error_code: '30003', error_message: 'الجهاز غير متاح.' })
export const messageFailed = message({ id: 6, to: '+966555000006', state: 'failed', sent_at: null, error_code: '21211', error_message: 'رقم المستلم غير صحيح.' })
export const messageUnconfirmed = message({ id: 7, to: '+966555000007', state: 'unconfirmed', sent_at: null })
export const messageWhatsappTemplate = message({ id: 8, to: '+966555000008', channel: 'whatsapp', sender_id: 13, sender_value: '+14155238886', state: 'delivered', body: null, content_sid: `HX${'b'.repeat(32)}`, read_at: '2030-01-15T10:35:00Z' })

export const messages = IntegrationMessageListSchema.parse({
  items: [messageWhatsappTemplate, messageUnconfirmed, messageFailed, messageUndelivered, messageDelivered, messageSentNoReceipt, messageSent, messageQueued],
  total: 8,
})
export const emptyMessages = IntegrationMessageListSchema.parse({ items: [], total: 0 })

/** The state view a test route answers with: the message without the log-only fields. */
export const stateOf = (row: (typeof messages)['items'][number]) => IntegrationMessageStateViewSchema.parse(Object.fromEntries(Object.keys(IntegrationMessageStateViewSchema.shape).map(key => [key, row[key as keyof typeof row]])))
