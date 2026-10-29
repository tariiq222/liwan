import { describe, expect, it } from 'vitest'
import {
  InboxAudienceListSchema,
  InboxAudiencePatchSchema,
  InboxAudienceWriteSchema,
  InboxCampaignParamSchema,
  InboxCampaignPatchSchema,
  InboxCampaignPreviewRequestSchema,
  InboxCampaignRecipientListSchema,
  InboxCampaignSchema,
  InboxCampaignSettingsPatchSchema,
  InboxCampaignSettingsSchema,
  InboxCampaignTestSendSchema,
  InboxCampaignWriteSchema,
  InboxChannelSendingPatchSchema,
  InboxChannelSendingSchema,
  InboxContactImportResultSchema,
  InboxContactImportSchema,
  InboxContactMarketingPatchSchema,
  InboxContactMarketingSchema,
} from '../campaigns'

const AT = '2026-01-01T09:00:00Z'
const ref = { id: 1, name: 'Main' }
const STATS = {
  total: 3, pending: 1, skipped: 0, queued: 0, sent: 0, delivered: 1, read: 1, failed: 0, replied: 1, unsubscribed: 0, held: 0,
}
const PARAM = { location: 'body', position: 1, source: 'contact_first_name', value: 'Customer' }
const CAMPAIGN = {
  id: 7,
  name: 'Spring',
  state: 'running',
  pause_reason: null,
  pause_detail: null,
  waiting: 'daily_cap',
  channel: ref,
  template: { id: 3, name: 'offer', language: 'ar', category: 'marketing' },
  audience: ref,
  params: [PARAM],
  header_attachment: null,
  scheduled_at: null,
  send_within_hours: false,
  daily_cap: 0,
  launched_at: AT,
  launched_by: ref,
  completed_at: null,
  stats: STATS,
  can_edit: false,
  can_delete: false,
  created_at: AT,
}
const WRITE = {
  name: 'Spring',
  channel_id: 1,
  template_id: 3,
  audience_id: 2,
  params: [PARAM],
  header_attachment_id: null,
  scheduled_at: null,
  send_within_hours: false,
  daily_cap: 0,
}

describe('campaign contracts', () => {
  it('parse a campaign and refuse an unknown key', () => {
    expect(InboxCampaignSchema.parse(CAMPAIGN)).toEqual(CAMPAIGN)
    expect(InboxCampaignSchema.safeParse({ ...CAMPAIGN, extra: 1 }).success).toBe(false)
    expect(InboxCampaignSchema.safeParse({ ...CAMPAIGN, stats: { ...STATS, extra: 1 } }).success).toBe(false)
    expect(InboxCampaignSchema.safeParse({ ...CAMPAIGN, state: 'archived' }).success).toBe(false)
  })

  it('require a value for a static parameter', () => {
    expect(InboxCampaignParamSchema.safeParse({ ...PARAM, source: 'static', value: null }).success).toBe(false)
    expect(InboxCampaignParamSchema.safeParse({ ...PARAM, source: 'static', value: 'Hello' }).success).toBe(true)
    expect(InboxCampaignParamSchema.safeParse({ ...PARAM, value: null }).success).toBe(true)
  })

  it('require every field to create a campaign and any one to patch it', () => {
    expect(InboxCampaignWriteSchema.parse(WRITE)).toEqual(WRITE)
    const { audience_id: _audience, ...partial } = WRITE
    expect(InboxCampaignWriteSchema.safeParse(partial).success).toBe(false)
    expect(InboxCampaignPatchSchema.safeParse({}).success).toBe(false)
    expect(InboxCampaignPatchSchema.parse({ daily_cap: 10 })).toEqual({ daily_cap: 10 })
    expect(InboxCampaignPatchSchema.safeParse({ daily_cap: 1_000_001 }).success).toBe(false)
    expect(InboxCampaignPatchSchema.safeParse({ scheduled_at: '2026-01-01 09:00' }).success).toBe(false)
  })

  it('need a proof for an opt-in and none for an opt-out', () => {
    expect(InboxContactMarketingPatchSchema.safeParse({ consent: { state: 'opted_in' } }).success).toBe(false)
    expect(InboxContactMarketingPatchSchema.safeParse({ consent: { state: 'opted_in', note: 'website form' } }).success).toBe(true)
    expect(InboxContactMarketingPatchSchema.safeParse({ consent: { state: 'opted_out' } }).success).toBe(true)
    expect(InboxContactMarketingPatchSchema.safeParse({}).success).toBe(false)
    expect(InboxContactMarketingPatchSchema.safeParse({ consent: { state: 'unknown' } }).success).toBe(false)
  })

  it('need a note for an opted-in import', () => {
    const base = { name: 'list.csv', data: 'cGhvbmU=', tag_ids: [1], consent: 'opted_in' as const }
    expect(InboxContactImportSchema.safeParse(base).success).toBe(false)
    expect(InboxContactImportSchema.safeParse({ ...base, consent_note: 'signed form' }).success).toBe(true)
    expect(InboxContactImportSchema.safeParse({ ...base, consent: 'unknown' }).success).toBe(true)
    expect(InboxContactImportSchema.safeParse({ ...base, consent: 'opted_out' }).success).toBe(false)
    expect(InboxContactImportSchema.safeParse({ ...base, consent_note: 'x', tag_ids: Array(11).fill(1) }).success).toBe(false)
    expect(InboxContactImportResultSchema.safeParse({ created: 1, updated: 0, skipped: 1, errors: [{ line: 3, message: 'bad' }] }).success).toBe(true)
    expect(InboxContactImportResultSchema.safeParse({ created: 1, updated: 0, skipped: 0, errors: [{ line: 0, message: 'bad' }] }).success).toBe(false)
  })

  it('parse contact marketing with a bounded history', () => {
    const marketing = {
      contact_id: 4,
      consent: 'opted_out',
      consent_at: AT,
      consent_source: 'keyword',
      tags: [ref],
      history: [{ state: 'opted_out', source: 'keyword', note: 'stop', author: null, at: AT }],
    }
    expect(InboxContactMarketingSchema.parse(marketing)).toEqual(marketing)
    expect(InboxContactMarketingSchema.safeParse({ ...marketing, history: Array(21).fill(marketing.history[0]) }).success).toBe(false)
  })

  it('parse audiences, sending health and the settings', () => {
    const audience = {
      id: 2, name: 'VIP', tags: [ref], tag_match: 'all', exclude_tags: [], active_within_days: 30,
      contact_count: 10, reachable_count: 8, created_at: AT,
    }
    expect(InboxAudienceListSchema.parse({ items: [audience], total: 1 }).items[0]).toEqual(audience)
    expect(InboxAudienceWriteSchema.safeParse({ name: 'VIP', tag_ids: [1], tag_match: 'any', exclude_tag_ids: [], active_within_days: 3651 }).success).toBe(false)
    expect(InboxAudiencePatchSchema.safeParse({}).success).toBe(false)
    const sending = {
      channel_id: 1, messaging_limit: 'tier_2k', quality_rating: 'green', used_24h: 10, remaining_24h: null,
      marketing_api: 'cloud_api', marketing_onboarding: 'eligible', checked_at: null,
    }
    expect(InboxChannelSendingSchema.parse(sending)).toEqual(sending)
    expect(InboxChannelSendingPatchSchema.safeParse({ marketing_api: 'marketing_messages' }).success).toBe(true)
    expect(InboxChannelSendingPatchSchema.safeParse({ marketing_api: 'sms' }).success).toBe(false)
    const settings = {
      consent_policy: 'opted_in_only', default_country_code: '966', keyword_opt_out: true, stop_keywords: ['stop'],
      start_keywords: ['start'], stop_reply: null, start_reply: 'ok', default_daily_cap: 0,
    }
    expect(InboxCampaignSettingsSchema.parse(settings)).toEqual(settings)
    expect(InboxCampaignSettingsSchema.safeParse({ ...settings, default_country_code: '0966' }).success).toBe(false)
    expect(InboxCampaignSettingsPatchSchema.safeParse({ stop_keywords: Array(31).fill('x') }).success).toBe(false)
  })

  it('parse previews, test sends and recipients', () => {
    expect(InboxCampaignPreviewRequestSchema.safeParse({ template_id: 3, params: [PARAM], contact_id: 4 }).success).toBe(true)
    expect(InboxCampaignTestSendSchema.safeParse({}).success).toBe(false)
    const recipient = {
      id: 1,
      contact: { id: 4, name: 'Sara', phone: null },
      state: 'failed',
      skip_reason: null,
      failure: 'frequency_capped',
      error_code: 131049,
      error: 'limit',
      conversation_id: 9,
      sent_at: AT,
      replied_at: null,
      unsubscribed_at: null,
      can_retry: true,
    }
    expect(InboxCampaignRecipientListSchema.parse({ items: [recipient], total: 1 }).items[0]).toEqual(recipient)
    expect(InboxCampaignRecipientListSchema.safeParse({ items: [{ ...recipient, failure: 'weird' }], total: 1 }).success).toBe(false)
  })
})
