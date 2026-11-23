import {
  IntegrationAvailableNumberListSchema,
  IntegrationCallListSchema,
  IntegrationCallSchema,
  IntegrationCallStateViewSchema,
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
    { code: 'meta', auth: 'keys', secrets: ['access_token', 'app_secret'], generated_secrets: ['verify_token'], attributes: ['app_id'], uses: [{ key: 'inbox.whatsapp', owner: 'liwan_inbox' }], settings_path: null, oauth_ready: null },
    { code: 'tiktok', auth: 'oauth', secrets: [], generated_secrets: [], attributes: [], uses: [{ key: 'inbox.tiktok', owner: 'liwan_inbox' }], settings_path: null, oauth_ready: true },
    { code: 'paymob', auth: 'external', secrets: [], generated_secrets: [], attributes: [], uses: [], settings_path: '/settings/apps/payments#providers', oauth_ready: null },
    { code: 'twilio', auth: 'keys', secrets: ['auth_token'], generated_secrets: [], attributes: [], uses: [{ key: 'twilio.messaging', owner: 'liwan_integrations_sa' }, { key: 'twilio.voice', owner: 'liwan_integrations_sa' }, { key: 'twilio.lookup', owner: 'liwan_integrations_sa' }], settings_path: null, oauth_ready: null },
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
    { id: 15, connection_id: 3, provider: 'twilio', channel: 'voice', kind: 'number', value: '+966500000003', is_default: true, active: true, created_at: '2030-01-13T08:00:00Z' },
  ],
  total: 4,
})
export const archivedSenders = IntegrationSenderListSchema.parse({
  items: [{ id: 14, connection_id: 3, provider: 'twilio', channel: 'sms', kind: 'service', value: `MG${'a'.repeat(32)}`, is_default: false, active: false, created_at: '2030-01-05T08:00:00Z' }],
  total: 1,
})

export const availableNumbers = IntegrationAvailableNumberListSchema.parse({
  items: [
    { value: '+966500000001', label: 'خط المتجر', sms: true, voice: true },
    { value: '+966500000002', label: '', sms: true, voice: false },
    { value: '+966500000003', label: 'خط صوت فقط', sms: false, voice: true },
  ],
  total: 3,
})

export const settings = IntegrationCommunicationSettingsSchema.parse({ daily_message_limit: 1000, daily_call_limit: 200, record_calls: false })

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

/** The state view a test route answers with: the message without the log-only fields. */
export const stateOf = (row: (typeof messages)['items'][number]) => IntegrationMessageStateViewSchema.parse(Object.fromEntries(Object.keys(IntegrationMessageStateViewSchema.shape).map(key => [key, row[key as keyof typeof row]])))

const callBase = { connection_id: 3, sender_id: 15, provider: 'twilio', from_value: '+966500000003', mode: 'speak', bridge_to: null, origin: 'test', recorded: false, recording_ref: null, recording_duration_seconds: null, error_code: null, error_message: null, created_at: '2030-01-15T11:00:00Z', started_at: null, ended_at: null, account_ref: 'ACtwiliotestaccount', speak_text: null, requested_by: { id: 7, name: 'سارة' }, provider_call_id: 'CAtwiliotestcall', duration_seconds: null }
const call = (overrides: Record<string, unknown>) => IntegrationCallSchema.parse({ ...callBase, ...overrides })
const SPEAK_TEXT = 'مرحبًا، هذه مكالمة تجريبية من ليوان.'

export const callInitiated = call({ id: 101, to: '+966555000011', state: 'initiated', speak_text: SPEAK_TEXT })
export const callRinging = call({ id: 102, to: '+966555000012', state: 'ringing', speak_text: SPEAK_TEXT, started_at: '2030-01-15T11:00:05Z' })
export const callInProgress = call({ id: 103, to: '+966555000013', state: 'in_progress', speak_text: SPEAK_TEXT, started_at: '2030-01-15T11:00:08Z' })
export const callCompleted = call({ id: 104, to: '+966555000014', state: 'completed', speak_text: SPEAK_TEXT, started_at: '2030-01-15T11:00:08Z', ended_at: '2030-01-15T11:00:59Z', duration_seconds: 51 })
export const callBusy = call({ id: 105, to: '+966555000015', state: 'busy', started_at: '2030-01-15T11:05:00Z', ended_at: '2030-01-15T11:05:04Z', duration_seconds: 4 })
export const callNoAnswer = call({ id: 106, to: '+966555000016', state: 'no_answer', started_at: '2030-01-15T11:10:00Z', ended_at: '2030-01-15T11:10:30Z' })
export const callFailed = call({ id: 107, to: '+966555000017', state: 'failed', error_code: '21215', error_message: 'رقم المستلم لا يقبل المكالمات.' })
export const callCanceled = call({ id: 108, to: '+966555000018', state: 'canceled', started_at: '2030-01-15T11:15:00Z', ended_at: '2030-01-15T11:15:02Z' })
export const callUnconfirmed = call({ id: 109, to: '+966555000019', state: 'unconfirmed' })
export const callBridgeRecorded = call({
  id: 110, to: '+966555000020', mode: 'bridge', bridge_to: '+966500000004', state: 'completed', recorded: true,
  recording_ref: `RE${'c'.repeat(32)}`, recording_duration_seconds: 122, started_at: '2030-01-15T11:20:10Z', ended_at: '2030-01-15T11:22:30Z', duration_seconds: 140,
})

export const calls = IntegrationCallListSchema.parse({
  items: [callBridgeRecorded, callUnconfirmed, callCanceled, callFailed, callNoAnswer, callBusy, callCompleted, callInProgress, callRinging, callInitiated],
  total: 10,
})

/** The state view the voice test route answers with: the call without the log-only fields. */
export const callStateOf = (row: (typeof calls)['items'][number]) => IntegrationCallStateViewSchema.parse(Object.fromEntries(Object.keys(IntegrationCallStateViewSchema.shape).map(key => [key, row[key as keyof typeof row]])))
