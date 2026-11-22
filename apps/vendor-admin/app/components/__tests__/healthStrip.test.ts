import { describe, expect, it } from 'vitest'
import { SERVICE_COMPONENTS, type ServiceHealthItem } from '@liwan/commercial-contracts'
import { healthChips } from '../../utils/vendorHealth'
import { loadSfc } from './sfc'

const now = new Date('2026-11-22T12:00:00Z')
const sfc = loadSfc('components/vendor/HealthStrip.vue', {
  useI18n: () => ({ t: (key: string, params?: unknown) => (params === undefined ? key : `${key}#${Object.values(params as object).join(',')}`), n: (v: number) => String(v) }),
  healthChips, formatBusinessDateTime: (v: string) => `at ${v}`,
})
const item = (component: ServiceHealthItem['component'], o: Partial<ServiceHealthItem> = {}): ServiceHealthItem =>
  ({ component, state: 'ok', since: '2026-11-22T08:00:00Z', last_beat_at: '2026-11-22T11:58:00Z', detail: null, ...o })
const all = (o: Partial<Record<ServiceHealthItem['component'], Partial<ServiceHealthItem>>> = {}) => SERVICE_COMPONENTS.map(c => item(c, o[c]))
const render = (items: ServiceHealthItem[] | null, lastCheckAt: string | null = null) => sfc.html({ items, now, lastCheckAt })

describe('VendorHealthStrip', () => {
  it('shows each component with its name and state word', async () => {
    const html = await render(all())
    for (const c of SERVICE_COMPONENTS) expect(html).toContain(`vendor.today.health.components.${c}`)
    expect(html).toContain('vendor.today.health.states.ok')
    expect(html).toContain('data-testid="health-shared_worker"')
    expect(html).toContain('data-state="ok"')
  })
  it('shows the time since the last beat of a process, and none for an adapter', async () => {
    const html = await render(all())
    expect(html).toContain('vendor.today.health.agoMinutes#2')
    expect(html.match(/vendor\.today\.health\.agoMinutes/g)).toHaveLength(2)
  })
  it('shows a stale and an unavailable service in words, with the reason code only when the server gave it', async () => {
    const html = await render(all({ shared_worker: { state: 'stale', last_beat_at: '2026-11-22T08:00:00Z' }, api_payment_adapter: { state: 'unavailable', detail: { available: false, code: 'provider_not_configured' } } }))
    expect(html).toContain('data-state="stale"')
    expect(html).toContain('vendor.today.health.states.stale')
    expect(html).toContain('vendor.today.health.agoHours#4')
    expect(html).toContain('vendor.today.health.states.unavailable')
    expect(html).toContain('provider_not_configured')
    expect(await render(all({ api_payment_adapter: { state: 'unavailable' } }))).not.toContain('provider_not_configured')
  })
  it('shows an adapter of a stale worker as unknown', async () => {
    const html = await render(all({ shared_worker: { state: 'stale' }, payment_adapter: { state: 'unavailable' } }))
    expect(html).toContain('data-testid="health-payment_adapter" data-state="unknown"')
    expect(html).toContain('vendor.today.health.states.unknown')
  })
  it('shows a service never seen plainly', async () => {
    const html = await render(all({ commercial_scheduler: { state: 'never_seen', since: null, last_beat_at: null } }))
    expect(html).toContain('data-testid="health-commercial_scheduler" data-state="never_seen"')
    expect(html).toContain('vendor.today.health.states.never_seen')
  })
  it('lists the scheduler\'s failed jobs when the server gave them', async () => {
    const html = await render(all({ commercial_scheduler: { detail: { failed_jobs: ['vendor-alerts'] } } }))
    expect(html).toContain('vendor.today.health.failedJobs#vendor-alerts')
  })
  it('says the health could not be read when it is null, and draws no chip', async () => {
    const html = await render(null, '2026-11-22T11:00:00Z')
    expect(html).toContain('vendor.today.health.unreadable')
    expect(html).not.toContain('data-state=')
    expect(html).toContain('at 2026-11-22T11:00:00Z')
  })
  it('labels the last workspace check, and leaves it out when there is none', async () => {
    expect(await render(all(), '2026-11-22T11:00:00Z')).toContain('vendor.today.health.lastWorkspaceCheck')
    expect(await render(all(), null)).not.toContain('vendor.today.health.lastWorkspaceCheck')
  })
})
