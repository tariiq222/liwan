import { describe, expect, it } from 'vitest'
import {
  InboxChannelAccountListSchema,
  InboxChannelCreateSchema,
  InboxChannelKindSchema,
  InboxChannelPatchSchema,
  InboxChannelSchema,
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

const TIKTOK_CONNECTION = {
  id: 2, provider: 'tiktok', external_id: 'open-id-77', label: 'liwan.shop', app_id: null, state: 'connected', status_message: '',
}

const TIKTOK_CHANNEL = {
  id: 4,
  name: 'TikTok shop',
  kind: 'tiktok',
  state: 'connected',
  department: null,
  phone_number_id: null,
  connection: TIKTOK_CONNECTION,
  last_error: null,
  last_event_at: '2026-11-05T09:00:00Z',
  health: HEALTH,
  needs_reconnect: false,
  tiktok_welcome_audit: 'reviewing',
  tiktok_questions_enabled: true,
  tiktok_prompts_enabled: false,
}

const WHATSAPP_CHANNEL = {
  ...TIKTOK_CHANNEL,
  kind: 'whatsapp',
  phone_number_id: '100000000001',
  connection: { id: 1, provider: 'meta', external_id: '200000000001', label: 'Flower shop', app_id: '555', state: 'connected', status_message: '' },
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
  it('creates either kind on a connected account, the number id being WhatsApp only', () => {
    expect(InboxChannelKindSchema.parse('tiktok')).toBe('tiktok')
    expect(InboxChannelCreateSchema.parse({
      name: 'WhatsApp', kind: 'whatsapp', department_id: null, connection_id: 1, phone_number_id: '100000000001',
    }).kind).toBe('whatsapp')
    expect(InboxChannelCreateSchema.parse({ name: 'TikTok shop', kind: 'tiktok', connection_id: 2 }).kind).toBe('tiktok')
    expect(() => InboxChannelCreateSchema.parse({ name: 'WhatsApp', kind: 'whatsapp', connection_id: 1 })).toThrow()
    expect(() => InboxChannelCreateSchema.parse({ name: 'TikTok shop', kind: 'tiktok', connection_id: 2, phone_number_id: '100000000001' })).toThrow()
    expect(() => InboxChannelCreateSchema.parse({ name: 'TikTok shop', kind: 'tiktok' })).toThrow()
  })

  it('refuses a credential or an identity field in a create or a patch', () => {
    const create = { name: 'WhatsApp', kind: 'whatsapp', connection_id: 1, phone_number_id: '100000000001' }
    for (const extra of [{ access_token: 'x'.repeat(16) }, { app_secret: 'y'.repeat(16) }, { business_account_id: '200000000001' }, { app_id: '1234567890123' }]) {
      expect(() => InboxChannelCreateSchema.parse({ ...create, ...extra })).toThrow()
      expect(() => InboxChannelPatchSchema.parse(extra)).toThrow()
    }
  })

  it('parses both channel dumps with the connection they run on', () => {
    const tiktok = InboxChannelSchema.parse(TIKTOK_CHANNEL)
    expect([tiktok.kind, tiktok.phone_number_id, tiktok.connection.provider, tiktok.needs_reconnect]).toEqual(
      ['tiktok', null, 'tiktok', false],
    )
    const whatsapp = InboxChannelSchema.parse(WHATSAPP_CHANNEL)
    expect([whatsapp.phone_number_id, whatsapp.connection.id, whatsapp.connection.provider]).toEqual(['100000000001', 1, 'meta'])
    expect(() => InboxChannelSchema.parse({ ...TIKTOK_CHANNEL, connection: { ...TIKTOK_CONNECTION, provider: 'paymob' } })).toThrow()
    expect(() => InboxChannelSchema.parse({ ...TIKTOK_CHANNEL, connection: { ...TIKTOK_CONNECTION, secrets: [] } })).toThrow()
    expect(() => InboxChannelSchema.parse({ ...TIKTOK_CHANNEL, has_access_token: true })).toThrow()
    expect(() => InboxChannelSchema.parse({ ...TIKTOK_CHANNEL, needs_reconnect: null })).toThrow()
  })
})

describe('channel accounts', () => {
  it('lists the account references a channel is created on', () => {
    const items = [TIKTOK_CHANNEL.connection, WHATSAPP_CHANNEL.connection]
    expect(InboxChannelAccountListSchema.parse({ items, total: 2 }).items[1]!.app_id).toBe('555')
    expect(() => InboxChannelAccountListSchema.parse({ items: [{ ...items[0], secrets: [] }], total: 1 })).toThrow()
    expect(() => InboxChannelAccountListSchema.parse({ items: [{ id: 1, provider: 'meta', external_id: '1', label: '', state: 'connected', status_message: '' }], total: 1 })).toThrow()
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
