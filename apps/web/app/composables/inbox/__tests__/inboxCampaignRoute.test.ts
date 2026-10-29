import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_PAGE_SIZE, campaignListQuery, campaignPageOffset, memberQuery, parseAudienceListRoute, parseCampaignListRoute, parseMemberRoute, parseRecipientRoute,
  recipientQuery, serializeCampaignListRoute, serializeMemberRoute, serializeRecipientRoute,
} from '../inboxCampaignRoute'

describe('campaign list route', () => {
  it('parses an empty query to the defaults and ignores values it does not know', () => {
    expect(parseCampaignListRoute({})).toEqual({ state: '', channelId: null, q: '', offset: 0 })
    expect(parseCampaignListRoute({ state: 'archived', channel_id: '-2', offset: 'x', q: '  عروض ' })).toEqual({ state: '', channelId: null, q: 'عروض', offset: 0 })
  })

  it('round-trips every filter through the URL and keeps the URL clean by default', () => {
    const route = { state: 'running', channelId: 3, q: 'شتاء', offset: 40 } as const
    expect(parseCampaignListRoute(serializeCampaignListRoute(route))).toEqual(route)
    expect(serializeCampaignListRoute({ state: '', channelId: null, q: '', offset: 0 })).toEqual({})
  })

  it('sends the page window with the filters', () => {
    expect(campaignListQuery({ state: 'paused', channelId: 3, q: 'x', offset: 20 })).toEqual({ state: 'paused', channel_id: 3, q: 'x', limit: CAMPAIGN_PAGE_SIZE, offset: 20 })
    expect(campaignListQuery({ state: '', channelId: null, q: '', offset: 0 })).toEqual({ limit: CAMPAIGN_PAGE_SIZE, offset: 0 })
  })

  it('keeps a requested page inside the list', () => {
    expect(campaignPageOffset(99, 45)).toBe(40)
    expect(campaignPageOffset(0, 45)).toBe(0)
  })
})

describe('recipient and member routes', () => {
  it('round-trips the recipient filters', () => {
    const route = { state: 'failed', failure: 'frequency_capped', q: 'سارة', offset: 20 } as const
    expect(parseRecipientRoute(serializeRecipientRoute(route))).toEqual(route)
    expect(recipientQuery(route)).toEqual({ state: 'failed', failure: 'frequency_capped', q: 'سارة', limit: CAMPAIGN_PAGE_SIZE, offset: 20 })
    expect(parseRecipientRoute({ state: 'x', failure: 'y' })).toMatchObject({ state: '', failure: '' })
  })

  it('round-trips the member filters', () => {
    const route = { consent: 'opted_out', q: '05', offset: 20 } as const
    expect(parseMemberRoute(serializeMemberRoute(route))).toEqual(route)
    expect(memberQuery(route)).toEqual({ consent: 'opted_out', q: '05', limit: CAMPAIGN_PAGE_SIZE, offset: 20 })
    expect(parseMemberRoute({ consent: 'maybe' }).consent).toBe('')
  })

  it('parses the audience search', () => {
    expect(parseAudienceListRoute({ q: ' ا ', offset: '20' })).toEqual({ q: 'ا', offset: 20 })
  })
})
