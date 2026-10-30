import { describe, expect, it } from 'vitest'
import type { InboxCampaignStats } from '@liwan/contracts'
import { CAMPAIGN_POLL_MS, campaignActions, campaignPollInterval, campaignTiles, deliveredPercent, dispatchedPercent } from '../inboxCampaignPresentation'

const stats = (rest: Partial<InboxCampaignStats> = {}): InboxCampaignStats => ({
  total: 10, pending: 0, skipped: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0, unsubscribed: 0, held: 0, ...rest,
})

describe('campaign polling', () => {
  it('refetches every ten seconds only while the campaign is scheduled or running', () => {
    expect(CAMPAIGN_POLL_MS).toBe(10_000)
    expect(campaignPollInterval('running')).toBe(10_000)
    expect(campaignPollInterval('scheduled')).toBe(10_000)
    for (const state of ['draft', 'paused', 'done', 'cancelled', undefined] as const) expect(campaignPollInterval(state)).toBe(false)
  })
})

describe('campaign actions', () => {
  it.each([
    ['draft', stats(), ['launch']],
    ['scheduled', stats(), ['cancel']],
    ['running', stats(), ['pause', 'cancel']],
    ['paused', stats(), ['resume', 'cancel']],
    ['done', stats(), []],
    ['cancelled', stats({ failed: 2 }), []],
    ['done', stats({ failed: 2 }), ['retry']],
    ['running', stats({ failed: 1 }), ['pause', 'cancel', 'retry']],
  ] as const)('%s with %j offers %j', (state, figures, expected) => {
    expect(campaignActions({ state, stats: figures })).toEqual(expected)
  })
})

describe('campaign figures', () => {
  it('computes the delivered and dispatched shares over the recipients that were not skipped', () => {
    expect(deliveredPercent(stats({ total: 10, skipped: 2, delivered: 3, read: 1 }))).toBe(50)
    expect(dispatchedPercent(stats({ total: 10, skipped: 2, pending: 4 }))).toBe(50)
    expect(deliveredPercent(stats({ total: 2, skipped: 2 }))).toBeNull()
  })

  it('counts a read message as delivered and flags failures and unsubscribes', () => {
    const tiles = campaignTiles(stats({ delivered: 3, read: 2, failed: 1, unsubscribed: 1, held: 2 }), key => key)
    const byId = Object.fromEntries(tiles.map(tile => [tile.id, tile]))
    expect(byId.delivered).toMatchObject({ value: '5', tone: 'success' })
    expect(byId.failed?.tone).toBe('danger')
    expect(byId.unsubscribed?.tone).toBe('warning')
    expect(byId.held?.hint).toBe('inbox.campaigns.stats.heldHint')
  })
})
