import { describe, expect, it } from 'vitest'
import type { AttentionItem } from '@webvue/commercial-contracts'
import { attentionMessage, attentionPresentation, daysSinceRenewal, daysUntil } from '../vendorAttention'

const now = new Date('2026-10-16T12:00:00Z')
const item = (o: Partial<AttentionItem>): AttentionItem => ({ kind: 'setup_required', customer_id: 'c1', tenant_id: null, operation_id: null, invoice_id: null, name: 'شركة س', since: '2026-10-04T12:00:00Z', detail: null, ...o })

describe('attentionPresentation', () => {
  it('opens the exact place for every kind', () => {
    expect(attentionPresentation(item({ kind: 'past_due', invoice_id: 'i1' })).to).toEqual({ path: '/invoices/i1' })
    expect(attentionPresentation(item({ kind: 'past_due' })).to).toEqual({ path: '/customers/c1', query: { tab: 'invoices' } })
    expect(attentionPresentation(item({ kind: 'stalled_activation' })).to).toEqual({ path: '/customers/c1', query: { tab: 'workspace' } })
    expect(attentionPresentation(item({ kind: 'setup_required' })).to).toEqual({ path: '/customers/c1', query: { tab: 'subscription' } })
    expect(attentionPresentation(item({ kind: 'renewal_soon' })).to).toEqual({ path: '/customers/c1', query: { tab: 'subscription' } })
    expect(attentionPresentation(item({ kind: 'renewal_missed' })).to).toEqual({ path: '/customers/c1', query: { tab: 'subscription' } })
    expect(attentionPresentation(item({ kind: 'operation_failed', customer_id: null, operation_id: 'o1' })).to).toEqual({ path: '/operations/o1', query: { source: 'legacy', returnTo: '/overview' } })
  })
  it('links nowhere rather than to a guessed page when the record is missing', () => {
    expect(attentionPresentation(item({ kind: 'setup_required', customer_id: null })).to).toBeNull()
    expect(attentionPresentation(item({ kind: 'operation_failed', operation_id: null })).to).toBeNull()
  })
})

describe('attentionMessage', () => {
  it('counts overdue and waiting days from `since`', () => {
    expect(attentionMessage(item({ kind: 'past_due' }), now)).toEqual({ key: 'past_due', days: 12, operation: null })
    expect(attentionMessage(item({ kind: 'stalled_activation', detail: 'applying', since: '2026-10-14T12:00:00Z' }), now)).toMatchObject({ key: 'stalled_waiting', days: 2 })
  })
  it('says a failed activation failed instead of counting days', () => {
    for (const detail of ['failed', 'needs_intervention']) expect(attentionMessage(item({ kind: 'stalled_activation', detail }), now)).toMatchObject({ key: 'stalled_failed', days: null })
  })
  it('carries the failed operation type and counts days to a renewal', () => {
    expect(attentionMessage(item({ kind: 'operation_failed', detail: 'upgrade' }), now)).toMatchObject({ operation: 'upgrade' })
    expect(attentionMessage(item({ kind: 'renewal_soon', since: '2026-10-19T00:00:00Z' }), now)).toMatchObject({ key: 'renewal_soon', days: 3 })
    expect(daysUntil('2026-10-10T00:00:00Z', now)).toBe(0)
  })
  it('counts renewal days on the Riyadh calendar, as the server dates them', () => {
    // 2026-10-19 in Riyadh starts at 21:00 UTC the day before; at 22:00 UTC on the 18th Riyadh is already the 19th.
    expect(daysUntil('2026-10-18T21:00:00Z', new Date('2026-10-18T20:59:00Z'))).toBe(1)
    expect(daysUntil('2026-10-18T21:00:00Z', new Date('2026-10-18T22:00:00Z'))).toBe(0)
    expect(daysUntil('2026-10-18T21:00:00Z', new Date('2026-10-16T12:00:00Z'))).toBe(3)
  })
  it('counts the days a missed renewal has waited', () => {
    expect(daysSinceRenewal('2026-10-12T21:00:00Z', now)).toBe(3)
    expect(attentionMessage(item({ kind: 'renewal_missed', since: '2026-10-12T21:00:00Z' }), now)).toEqual({ key: 'renewal_missed', days: 3, operation: null })
  })
})
