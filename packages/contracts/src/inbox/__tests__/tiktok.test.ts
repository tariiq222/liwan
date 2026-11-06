import { describe, expect, it } from 'vitest'
import {
  InboxChannelCreateSchema,
  InboxChannelKindSchema,
  InboxChannelSchema,
  InboxTikTokConnectResponseSchema,
  InboxTikTokConnectSchema,
  InboxTikTokShortcutCreateSchema,
  InboxTikTokShortcutEnableResultSchema,
  InboxTikTokShortcutEnableSchema,
  InboxTikTokShortcutListSchema,
  InboxTikTokShortcutPatchSchema,
  InboxTikTokShortcutSchema,
  InboxTikTokSyncAnswerSchema,
  InboxTikTokSyncSchema,
} from '../index'

// One real channel dump as dump_channel writes it, and one TikTok shortcut and sync job as their serializers
// write them. The parity is with odoo-addons/liwan_inbox/serializers/settings.py and serializers/tiktok.py.
const HEALTH = {
  display_phone_number: null,
  verified_name: null,
  name_status: 'unknown',
  requested_name: null,
  name_rejection_reason: null,
  quality_rating: 'unknown',
  messaging_limit: 'unknown',
  throughput_level: 'unknown',
  code_verified: false,
  account_state: 'active',
  account_restricted_until: null,
  checked_at: null,
  template_insights_enabled: false,
  currency: null,
  analytics_synced_at: null,
  analytics_error: null,
}

const TIKTOK_CHANNEL = {
  id: 4,
  name: 'TikTok shop',
  kind: 'tiktok',
  state: 'connected',
  department: null,
  phone_number_id: null,
  business_account_id: null,
  has_access_token: true,
  has_app_secret: null,
  app_id: null,
  has_verify_token: null,
  callback_url: 'https://app.example.test/api/v1/inbox/hooks/tiktok',
  last_error: null,
  last_event_at: '2026-11-05T09:00:00Z',
  health: HEALTH,
  tiktok_username: 'liwan_shop',
  token_expires_at: '2026-11-06T09:00:00Z',
  needs_reconnect: false,
  tiktok_welcome_audit: 'reviewing',
  tiktok_questions_enabled: true,
  tiktok_prompts_enabled: false,
}

const WHATSAPP_CHANNEL = {
  ...TIKTOK_CHANNEL,
  kind: 'whatsapp',
  phone_number_id: '100000000001',
  business_account_id: '200000000001',
  has_app_secret: true,
  app_id: '1234567890123',
  has_verify_token: true,
  callback_url: 'https://app.example.test/api/v1/inbox/hooks/whatsapp',
  tiktok_username: null,
  token_expires_at: null,
  tiktok_welcome_audit: null,
  tiktok_questions_enabled: false,
}

const QUESTION = {
  id: 8,
  kind: 'question',
  sequence: 10,
  question: 'Do you deliver?',
  answer: 'Yes, city-wide.',
  title: null,
  content: null,
  provider_id: 'am-question-1',
  audit: 'reviewing',
  sync_error: null,
}

const SYNC = {
  id: 3,
  state: 'running',
  phase: 'messages',
  conversations_count: 12,
  messages_count: 40,
  error: null,
  started_at: '2026-11-05T09:00:00Z',
  finished_at: null,
  created_at: '2026-11-05T08:59:00Z',
}

describe('inbox channel kinds', () => {
  it('accepts TikTok and refuses to create it by hand', () => {
    expect(InboxChannelKindSchema.parse('tiktok')).toBe('tiktok')
    expect(() => InboxChannelCreateSchema.parse({
      name: 'TikTok shop', kind: 'tiktok', phone_number_id: '100000000001',
      business_account_id: '200000000001', access_token: 'x'.repeat(16), app_secret: 'y'.repeat(16),
    })).toThrow()
    expect(InboxChannelCreateSchema.parse({
      name: 'WhatsApp', kind: 'whatsapp', phone_number_id: '100000000001',
      business_account_id: '200000000001', access_token: 'x'.repeat(16), app_secret: 'y'.repeat(16),
    }).kind).toBe('whatsapp')
  })

  it('parses both channel dumps: WhatsApp identity and TikTok account fields', () => {
    const tiktok = InboxChannelSchema.parse(TIKTOK_CHANNEL)
    expect([tiktok.kind, tiktok.phone_number_id, tiktok.tiktok_username, tiktok.needs_reconnect]).toEqual(
      ['tiktok', null, 'liwan_shop', false],
    )
    expect(tiktok.callback_url.endsWith('/hooks/tiktok')).toBe(true)
    const whatsapp = InboxChannelSchema.parse(WHATSAPP_CHANNEL)
    expect([whatsapp.phone_number_id, whatsapp.has_app_secret, whatsapp.tiktok_username]).toEqual(
      ['100000000001', true, null],
    )
    expect(() => InboxChannelSchema.parse({ ...TIKTOK_CHANNEL, tiktok_username: 1 })).toThrow()
    expect(() => InboxChannelSchema.parse({ ...TIKTOK_CHANNEL, needs_reconnect: null })).toThrow()
  })
})

describe('connect request', () => {
  it('needs a name for a new channel and an id to reconnect one', () => {
    expect(InboxTikTokConnectSchema.parse({ name: 'TikTok shop' })).toEqual({ name: 'TikTok shop' })
    expect(InboxTikTokConnectSchema.parse({ channel_id: 4 })).toEqual({ channel_id: 4 })
    expect(InboxTikTokConnectSchema.parse({ channel_id: 4, name: 'Renamed', department_id: null })).toBeTruthy()
    expect(() => InboxTikTokConnectSchema.parse({ department_id: 2 })).toThrow()
    expect(() => InboxTikTokConnectSchema.parse({ name: '' })).toThrow()
    expect(() => InboxTikTokConnectSchema.parse({ name: 'x', bogus: 1 })).toThrow()
  })

  it('answers an https authorization page', () => {
    const url = 'https://www.tiktok.com/v2/auth/authorize?client_key=key&state=abc'
    expect(InboxTikTokConnectResponseSchema.parse({ authorize_url: url }).authorize_url).toBe(url)
    expect(() => InboxTikTokConnectResponseSchema.parse({ authorize_url: 'http://www.tiktok.com/x' })).toThrow()
  })
})

describe('suggested questions and chat prompts', () => {
  it('parses one item, its list and both kinds of create', () => {
    expect(InboxTikTokShortcutSchema.parse(QUESTION)).toEqual(QUESTION)
    expect(InboxTikTokShortcutListSchema.parse({ items: [QUESTION], total: 1 }).total).toBe(1)
    expect(InboxTikTokShortcutCreateSchema.parse({
      kind: 'question', question: QUESTION.question, answer: QUESTION.answer,
    })).toEqual({ kind: 'question', question: QUESTION.question, answer: QUESTION.answer })
    expect(InboxTikTokShortcutCreateSchema.parse({
      kind: 'prompt', title: 'Order', content: 'I want to order', sequence: 20,
    }).kind).toBe('prompt')
    // Exactly the fields of the kind.
    expect(() => InboxTikTokShortcutCreateSchema.parse({
      kind: 'question', question: 'Q?', answer: 'A', title: 'Not a prompt',
    })).toThrow()
    expect(() => InboxTikTokShortcutCreateSchema.parse({
      kind: 'prompt', title: 'Order', content: 'I want to order', question: 'Q?',
    })).toThrow()
  })

  it("holds TikTok's limits", () => {
    expect(() => InboxTikTokShortcutCreateSchema.parse({
      kind: 'question', question: 'q'.repeat(81), answer: 'a',
    })).toThrow()
    expect(() => InboxTikTokShortcutCreateSchema.parse({
      kind: 'question', question: 'q', answer: 'a'.repeat(201),
    })).toThrow()
    expect(() => InboxTikTokShortcutCreateSchema.parse({
      kind: 'prompt', title: 't'.repeat(19), content: 'c',
    })).toThrow()
    expect(() => InboxTikTokShortcutCreateSchema.parse({
      kind: 'prompt', title: 't', content: 'c'.repeat(151),
    })).toThrow()
    expect(() => InboxTikTokShortcutCreateSchema.parse({
      kind: 'question', question: 'q', answer: 'a', sequence: 1001,
    })).toThrow()
  })

  it('patches at least one field', () => {
    expect(InboxTikTokShortcutPatchSchema.parse({ answer: 'Tomorrow' })).toEqual({ answer: 'Tomorrow' })
    expect(InboxTikTokShortcutPatchSchema.parse({ sequence: 0 })).toEqual({ sequence: 0 })
    expect(() => InboxTikTokShortcutPatchSchema.parse({})).toThrow()
    expect(() => InboxTikTokShortcutPatchSchema.parse({ provider_id: 'am-1' })).toThrow()
  })

  it('switches a kind on or off and answers the stored items', () => {
    expect(InboxTikTokShortcutEnableSchema.parse({ kind: 'prompt', enabled: true })).toEqual({ kind: 'prompt', enabled: true })
    expect(() => InboxTikTokShortcutEnableSchema.parse({ kind: 'prompt', enabled: 'yes' })).toThrow()
    const answer = InboxTikTokShortcutEnableResultSchema.parse({
      kind: 'question', enabled: true, items: [QUESTION], total: 1,
    })
    expect([answer.kind, answer.enabled, answer.items[0].provider_id]).toEqual(['question', true, 'am-question-1'])
  })
})

describe('history import', () => {
  it('parses a job and the nullable latest-job answer', () => {
    expect(InboxTikTokSyncSchema.parse(SYNC)).toEqual(SYNC)
    expect(InboxTikTokSyncAnswerSchema.parse({ job: SYNC }).job?.phase).toBe('messages')
    expect(InboxTikTokSyncAnswerSchema.parse({ job: null })).toEqual({ job: null })
    expect(() => InboxTikTokSyncSchema.parse({ ...SYNC, state: 'paused' })).toThrow()
    expect(() => InboxTikTokSyncSchema.parse({ ...SYNC, phase: 'conversations' })).toThrow()
    expect(() => InboxTikTokSyncAnswerSchema.parse({ job: SYNC, total: 1 })).toThrow()
  })
})
