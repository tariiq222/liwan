import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { loadSfc } from './sfc'
import { operationStatusBadge } from '../../utils/vendorBadges'
import { sharedJobLocation, startRefusalKey } from '../../utils/sharedBackups'

const tenantId = '10000000-0000-4000-8000-000000000001'
const id = (n: number) => `10000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const item = (over: Record<string, unknown> = {}) => ({ backup_id: id(1), job_id: id(2), created_at: '2026-11-22T10:00:00.000Z', started_by: 'Layla', approval: null, restores: [], ...over })
const listing = (over: Record<string, unknown> = {}) => ({ start: { allowed: true, reason: null, job_id: null }, total: 1, items: [item()], ...over })

function panel(state: { data?: unknown; error?: unknown; pending?: boolean }) {
  const refresh = () => {}
  const fake = { data: Vue.ref(state.data ?? null), error: Vue.ref(state.error ?? null), pending: Vue.ref(state.pending ?? false), refresh }
  const sfc = loadSfc('components/vendor/BackupsPanel.vue', {
    useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key}[${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')}]` : key) }),
    useSharedBackups: () => fake, formatLiwanDateTime: (value: string) => `@${value}`, operationStatusBadge, sharedJobLocation, startRefusalKey,
  })
  return { sfc, fake, render: async () => sfc.mount({ tenantId }).render() }
}
const stateOf = (captured: { name: string; attrs: Record<string, unknown> }[]) => captured.find(entry => entry.name === 'SharedPageState')!.attrs

describe('BackupsPanel', () => {
  it('lists each backup with its time, who started it and the restores made from it', async () => {
    const { render } = panel({ data: listing({ items: [item({ restores: [{ job_id: id(3), approval_id: id(4), state: 'verified', created_at: '2026-11-22T11:00:00.000Z' }] })] }) })
    const { html } = await render()
    expect(html).toContain('data-testid="backups-list"')
    expect(html).toContain('@2026-11-22T10:00:00.000Z')
    expect(html).toContain('vendor.backups.startedBy[name=Layla]')
    expect(html).toContain('vendor.backups.restoreCopy[time=@2026-11-22T11:00:00.000Z]')
    expect(html).toContain(`data-backup="${id(1)}"`)
  })
  it('shows an open restore approval with its expiry and approver', async () => {
    const { render } = panel({ data: listing({ items: [item({ approval: { approval_id: id(5), expires_at: '2026-11-22T11:00:00.000Z', approved_by: 'Omar' } })] }) })
    const { html } = await render()
    expect(html).toContain('vendor.backups.approvalOpen[time=@2026-11-22T11:00:00.000Z]')
    expect(html).toContain('vendor.backups.approvedBy[name=Omar]')
  })
  it('names a backup whose starter is unknown instead of leaving a blank', async () => {
    const { render } = panel({ data: listing({ items: [item({ started_by: null })] }) })
    expect((await render()).html).toContain('vendor.backups.startedBy[name=vendor.common.unknown]')
  })
  it('passes an empty listing to the shared empty state', async () => {
    const { render } = panel({ data: listing({ total: 0, items: [] }) })
    const { captured, html } = await render()
    expect(stateOf(captured)).toMatchObject({ empty: true, 'empty-text': 'vendor.backups.empty' })
    expect(html).not.toContain('data-testid="backups-list"')
  })
  it('passes a failed load, a forbidden one included, to the shared state with a retry', async () => {
    const failure = { statusCode: 403, data: { code: 'forbidden' } }
    const { render, fake } = panel({ error: failure })
    const { captured } = await render()
    expect(stateOf(captured)).toMatchObject({ error: failure, empty: false })
    expect(stateOf(captured).onRetry).toBe(fake.refresh)
  })
  it('shows the loading state only until the first answer', async () => {
    expect(stateOf((await panel({ pending: true }).render()).captured)).toMatchObject({ loading: true })
    expect(stateOf((await panel({ pending: true, data: listing() }).render()).captured)).toMatchObject({ loading: false })
  })
  it('says why a backup cannot be started and links to the job that blocks it', async () => {
    const alertOf = (captured: { name: string; attrs: Record<string, unknown> }[]) => captured.find(entry => entry.name === 'UAlert')?.attrs
    const blocked = await panel({ data: listing({ start: { allowed: false, reason: 'job_in_progress', job_id: id(9) } }) }).render()
    expect(alertOf(blocked.captured)).toMatchObject({ title: 'vendor.backups.refusal.job_in_progress', 'data-testid': 'backups-start-refusal' })
    const link = blocked.captured.find(entry => entry.name === 'UButton')!
    expect(link.attrs.to).toEqual(sharedJobLocation(id(9))); expect(blocked.html).toContain('vendor.backups.viewBlocking')
    const off = await panel({ data: listing({ start: { allowed: false, reason: 'operations_unavailable', job_id: null } }) }).render()
    expect(alertOf(off.captured)).toMatchObject({ title: 'vendor.backups.refusal.operations_unavailable' })
    expect(off.captured.some(entry => entry.name === 'UButton')).toBe(false)
    expect(alertOf((await panel({ data: listing() }).render()).captured)).toBeUndefined()
  })
})
