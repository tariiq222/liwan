import { describe, expect, it } from 'vitest'
import { SERVICE_COMPONENTS, type ServiceHealthItem } from '@liwan/commercial-contracts'
import { elapsedSince, healthChips } from '../vendorHealth'

const now = new Date('2026-11-22T12:00:00Z')
const item = (component: ServiceHealthItem['component'], o: Partial<ServiceHealthItem> = {}): ServiceHealthItem =>
  ({ component, state: 'ok', since: '2026-11-22T08:00:00Z', last_beat_at: '2026-11-22T11:58:00Z', detail: null, ...o })
const all = (o: Partial<Record<ServiceHealthItem['component'], Partial<ServiceHealthItem>>> = {}) => SERVICE_COMPONENTS.map(c => item(c, o[c]))
const chip = (items: ServiceHealthItem[], component: ServiceHealthItem['component']) => healthChips(items, now).find(c => c.component === component)!

describe('elapsedSince', () => {
  it('counts whole minutes, then hours, then days', () => {
    expect(elapsedSince('2026-11-22T11:59:30Z', now)).toEqual({ unit: 'minutes', count: 0 })
    expect(elapsedSince('2026-11-22T11:58:00Z', now)).toEqual({ unit: 'minutes', count: 2 })
    expect(elapsedSince('2026-11-22T10:00:00Z', now)).toEqual({ unit: 'hours', count: 2 })
    expect(elapsedSince('2026-11-19T12:00:00Z', now)).toEqual({ unit: 'days', count: 3 })
  })
  it('never counts a time ahead of now as negative', () => { expect(elapsedSince('2026-11-22T12:05:00Z', now)).toEqual({ unit: 'minutes', count: 0 }) })
})

describe('healthChips', () => {
  it('shows one chip per component in the order given, an ok service in a calm tone with the time since its last beat', () => {
    expect(healthChips(all(), now).map(c => c.component)).toEqual([...SERVICE_COMPONENTS])
    expect(chip(all(), 'shared_worker')).toMatchObject({ state: 'ok', tone: 'success', lastBeat: { unit: 'minutes', count: 2 } })
  })
  it('shows a stale and an unavailable service as needing action', () => {
    const items = all({ shared_worker: { state: 'stale' }, api_payment_adapter: { state: 'unavailable', detail: { available: false, code: 'provider_not_configured' } }, mail_adapter: { state: 'unavailable', detail: { available: false, code: 'mail_not_configured' } } })
    expect(chip(items, 'shared_worker')).toMatchObject({ state: 'stale', tone: 'destructive' })
    expect(chip(items, 'api_payment_adapter')).toMatchObject({ state: 'unavailable', tone: 'destructive', code: 'provider_not_configured', lastBeat: null })
  })
  it('shows a service never seen plainly, in a neutral tone and with no time', () => {
    expect(chip(all({ commercial_scheduler: { state: 'never_seen', since: null, last_beat_at: null } }), 'commercial_scheduler')).toMatchObject({ state: 'never_seen', tone: 'neutral', lastBeat: null })
  })
  it('shows the adapters of a stale worker as unknown, whatever they last recorded, but not the API\'s own', () => {
    const items = all({ shared_worker: { state: 'stale' }, payment_adapter: { state: 'unavailable' }, alert_channel: { state: 'never_seen', since: null, last_beat_at: null } })
    expect(['payment_adapter', 'mail_adapter'].map(c => chip(items, c as never).state)).toEqual(['unknown', 'unknown'])
    expect(chip(items, 'payment_adapter').tone).toBe('neutral')
    expect(chip(items, 'alert_channel').state).toBe('never_seen')
    expect(chip(items, 'api_payment_adapter').state).toBe('ok')
    expect(chip(all({ shared_worker: { state: 'ok' }, payment_adapter: { state: 'unavailable' } }), 'payment_adapter').state).toBe('unavailable')
  })
  it('carries the failed job names of the scheduler and no other detail', () => {
    const items = all({ commercial_scheduler: { detail: { ticks: 9, last_billing_at: null, failed_jobs: ['vendor-alerts', 'fulfillment'] } } })
    expect(chip(items, 'commercial_scheduler').failedJobs).toEqual(['vendor-alerts', 'fulfillment'])
    expect(chip(all(), 'commercial_scheduler')).toMatchObject({ failedJobs: [], code: null })
  })
  it('ignores a detail that is not the shape it expects', () => {
    const items = all({ commercial_scheduler: { detail: { failed_jobs: 'x', code: 7 } }, mail_adapter: { state: 'unavailable', detail: { code: { nested: 1 } } } })
    expect(chip(items, 'commercial_scheduler')).toMatchObject({ failedJobs: [], code: null })
    expect(chip(items, 'mail_adapter').code).toBeNull()
  })
})
