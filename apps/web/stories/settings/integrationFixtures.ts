import { IntegrationConnectionListSchema, IntegrationConnectionSchema, IntegrationProviderListSchema } from '@liwan/contracts'

export const providers = IntegrationProviderListSchema.parse({
  items: [
    { code: 'meta', auth: 'keys', secrets: ['access_token', 'app_secret'], generated_secrets: ['verify_token'], attributes: ['app_id'], uses: [{ key: 'inbox.whatsapp', owner: 'liwan_inbox' }], settings_path: null },
    { code: 'tiktok', auth: 'oauth', secrets: [], generated_secrets: [], attributes: [], uses: [{ key: 'inbox.tiktok', owner: 'liwan_inbox' }], settings_path: null },
    { code: 'paymob', auth: 'external', secrets: [], generated_secrets: [], attributes: [], uses: [], settings_path: '/settings/apps/payments#providers' },
  ],
  total: 3,
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
