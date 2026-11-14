import { describe, expect, it } from 'vitest'
import {
  IntegrationConnectionCreateSchema,
  IntegrationConnectionListSchema,
  IntegrationConnectionSchema,
  IntegrationConnectionUpdateSchema,
  IntegrationOAuthStartResponseSchema,
  IntegrationOAuthStartSchema,
  IntegrationProviderListSchema,
  IntegrationProviderSchema,
  IntegrationSecretRotationSchema,
  IntegrationStateSchema,
} from '../index'

const PROVIDER = {
  code: 'meta', auth: 'keys', secrets: ['access_token', 'app_secret'], generated_secrets: ['verify_token'], attributes: ['app_id'],
  uses: [{ key: 'inbox.whatsapp', owner: 'liwan_inbox' }], settings_path: null,
}
const CONNECTION = {
  ref: 'connection:3', id: 3, provider: 'meta', auth: 'keys', external_id: '1029384756', label: 'متجر الورد',
  app_id: '555', state: 'connected', status_message: '', last_checked: '2030-01-15T10:30:00Z', token_expires_at: null,
  secrets: [{ name: 'access_token', present: true }, { name: 'verify_token', present: true }],
  used_by: ['inbox.whatsapp'],
  webhooks: [{ use: 'inbox.whatsapp', url: 'https://app.example/api/v1/inbox/hooks/whatsapp' }],
  settings_path: null,
}
const EXTERNAL = {
  ...CONNECTION, ref: 'external:zatca', id: null, provider: 'zatca', auth: 'external', external_id: null, label: '', app_id: null,
  state: 'not_configured', last_checked: null, secrets: [], used_by: [], webhooks: [], settings_path: '/settings/apps/finance#zatca',
}

describe('IntegrationProviderSchema', () => {
  it('accepts the registry shape and lists it with a total', () => {
    expect(IntegrationProviderSchema.parse(PROVIDER)).toEqual(PROVIDER)
    expect(IntegrationProviderListSchema.parse({ items: [PROVIDER], total: 1 }).total).toBe(1)
  })

  it('is strict and rejects an unknown auth type or a relative settings path', () => {
    expect(() => IntegrationProviderSchema.parse({ ...PROVIDER, token: 'x' })).toThrow()
    expect(() => IntegrationProviderSchema.parse({ ...PROVIDER, auth: 'basic' })).toThrow()
    expect(() => IntegrationProviderSchema.parse({ ...PROVIDER, settings_path: 'settings' })).toThrow()
    expect(() => IntegrationProviderListSchema.parse({ items: [PROVIDER], total: -1 })).toThrow()
  })
})

describe('IntegrationConnectionSchema', () => {
  it('accepts a stored connection and an external one without an id', () => {
    expect(IntegrationConnectionSchema.parse(CONNECTION)).toEqual(CONNECTION)
    expect(IntegrationConnectionSchema.parse(EXTERNAL).id).toBeNull()
  })

  it('is strict: it exposes secret presence and never a value', () => {
    expect(() => IntegrationConnectionSchema.parse({ ...CONNECTION, access_token: 'x' })).toThrow()
    expect(() => IntegrationConnectionSchema.parse({ ...CONNECTION, secrets: [{ name: 'access_token', present: true, value: 'x' }] })).toThrow()
  })

  it('knows exactly the five states', () => {
    expect(IntegrationStateSchema.options).toEqual(['not_configured', 'pending', 'connected', 'error', 'disabled'])
    expect(() => IntegrationConnectionSchema.parse({ ...CONNECTION, state: 'ok' })).toThrow()
  })

  it('rejects a non-positive id, an empty ref and a malformed webhook address', () => {
    expect(() => IntegrationConnectionSchema.parse({ ...CONNECTION, id: 0 })).toThrow()
    expect(() => IntegrationConnectionSchema.parse({ ...CONNECTION, ref: '' })).toThrow()
    expect(() => IntegrationConnectionSchema.parse({ ...CONNECTION, webhooks: [{ use: 'inbox.whatsapp', url: 'not a url' }] })).toThrow()
  })

  it('wraps connections with a total and rejects extra keys', () => {
    expect(IntegrationConnectionListSchema.parse({ items: [CONNECTION, EXTERNAL], total: 2 }).items).toHaveLength(2)
    expect(() => IntegrationConnectionListSchema.parse({ items: [], total: 0, next: 2 })).toThrow()
  })
})

describe('IntegrationConnectionCreateSchema', () => {
  const body = { provider: 'meta', external_id: ' 1029384756 ', secrets: { access_token: ' token-1234 ' } }

  it('trims what the customer typed and keeps the optional fields optional', () => {
    expect(IntegrationConnectionCreateSchema.parse(body)).toEqual({ provider: 'meta', external_id: '1029384756', secrets: { access_token: 'token-1234' } })
    expect(IntegrationConnectionCreateSchema.parse({ ...body, label: 'x', app_id: '5' }).app_id).toBe('5')
  })

  it('refuses an empty account id, no secret, a blank secret and unknown keys', () => {
    expect(() => IntegrationConnectionCreateSchema.parse({ ...body, external_id: ' ' })).toThrow()
    expect(() => IntegrationConnectionCreateSchema.parse({ ...body, secrets: {} })).toThrow()
    expect(() => IntegrationConnectionCreateSchema.parse({ ...body, secrets: { access_token: ' ' } })).toThrow()
    expect(() => IntegrationConnectionCreateSchema.parse({ ...body, secrets: { access_token: 'short' } })).toThrow()
    expect(() => IntegrationConnectionCreateSchema.parse({ ...body, external_id: '1'.repeat(65) })).toThrow()
    expect(() => IntegrationConnectionCreateSchema.parse({ ...body, state: 'connected' })).toThrow()
  })
})

describe('IntegrationConnectionUpdateSchema', () => {
  it('accepts a label, secrets or the two allowed states', () => {
    expect(IntegrationConnectionUpdateSchema.parse({ state: 'disabled' }).state).toBe('disabled')
    expect(IntegrationConnectionUpdateSchema.parse({ state: 'pending' }).state).toBe('pending')
    expect(IntegrationConnectionUpdateSchema.parse({ secrets: { app_secret: 'secret-12' } }).secrets).toEqual({ app_secret: 'secret-12' })
  })

  it('refuses an empty body, a state the customer cannot set and unknown keys', () => {
    expect(() => IntegrationConnectionUpdateSchema.parse({})).toThrow()
    expect(() => IntegrationConnectionUpdateSchema.parse({ state: 'connected' })).toThrow()
    expect(() => IntegrationConnectionUpdateSchema.parse({ provider: 'tiktok' })).toThrow()
  })
})

describe('OAuth and rotation', () => {
  it('starts with at least one use and nothing else', () => {
    expect(IntegrationOAuthStartSchema.parse({ uses: ['inbox.tiktok'] }).uses).toEqual(['inbox.tiktok'])
    expect(() => IntegrationOAuthStartSchema.parse({ uses: [] })).toThrow()
    expect(() => IntegrationOAuthStartSchema.parse({ uses: ['inbox.tiktok'], connection_id: 4 })).toThrow()
  })

  it('answers with an https authorize address only', () => {
    expect(IntegrationOAuthStartResponseSchema.parse({ authorize_url: 'https://www.tiktok.com/v2/auth/authorize/' }).authorize_url).toContain('https://')
    expect(() => IntegrationOAuthStartResponseSchema.parse({ authorize_url: 'http://www.tiktok.com/auth' })).toThrow()
    expect(() => IntegrationOAuthStartResponseSchema.parse({ authorize_url: 'javascript:alert(1)' })).toThrow()
  })

  it('shows a rotated secret as a name and a value', () => {
    expect(IntegrationSecretRotationSchema.parse({ name: 'verify_token', value: 'abc' })).toEqual({ name: 'verify_token', value: 'abc' })
    expect(() => IntegrationSecretRotationSchema.parse({ name: 'verify_token', value: '' })).toThrow()
  })
})
