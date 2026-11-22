import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { loadSfc } from './sfc'
import { operationStatusBadge } from '../../utils/vendorBadges'
import { approvalUsable, backupJobRequest, restoreFromBackup, RestoreQueueFailed, sharedBackupErrorKey, sharedJobLocation, startRefusalKey } from '../../utils/sharedBackups'
import { reasonValid } from '../../utils/team'
import { StepUpCancelled, STEP_UP_CANCELLED_KEY } from '../../composables/useStepUp'

const tenantId = '10000000-0000-4000-8000-000000000001'
const id = (n: number) => `10000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const item = (over: Record<string, unknown> = {}) => ({ backup_id: id(1), job_id: id(2), created_at: '2026-11-22T10:00:00.000Z', started_by: 'Layla', approval: null, restores: [], ...over })
const listing = (over: Record<string, unknown> = {}) => ({ start: { allowed: true, reason: null, job_id: null }, total: 1, items: [item()], ...over })

type Setup = { data?: unknown; error?: unknown; pending?: boolean; capabilities?: string[]; request?: (path: string, options?: unknown) => Promise<unknown> }
function panel(state: Setup) {
  const refresh = vi.fn(async () => {})
  const fake = { data: Vue.ref(state.data ?? null), error: Vue.ref(state.error ?? null), pending: Vue.ref(state.pending ?? false), refresh }
  const request = vi.fn(state.request ?? (async () => ({ id: id(7), state: 'queued', replay: false })))
  const navigateTo = vi.fn(async () => {})
  const sfc = loadSfc('components/vendor/BackupsPanel.vue', {
    useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key}[${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')}]` : key) }),
    useSharedBackups: () => fake, formatLiwanDateTime: (value: string) => `@${value}`, operationStatusBadge, sharedJobLocation, startRefusalKey,
    approvalUsable, restoreFromBackup, RestoreQueueFailed, onMounted: () => {}, onBeforeUnmount: () => {}, backupJobRequest, sharedBackupErrorKey, reasonValid, useVendorApi: () => ({ request }), navigateTo, useHydrated: () => Vue.ref(true),
    useVendorContext: () => ({ can: (capability: string) => (state.capabilities ?? ['vendor.read', 'vendor.operations.run']).includes(capability) }),
  })
  const mounted = sfc.mount({ tenantId })
  return { sfc, fake, request, navigateTo, state: mounted.state, render: async () => mounted.render() }
}
const approval = { approval_id: id(5), expires_at: '2026-11-22T11:00:00.000Z', approved_by: 'Omar' }
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
    const link = blocked.captured.find(entry => entry.name === 'UButton' && entry.attrs.to)!
    expect(link.attrs.to).toEqual(sharedJobLocation(id(9))); expect(blocked.html).toContain('vendor.backups.viewBlocking')
    const off = await panel({ data: listing({ start: { allowed: false, reason: 'operations_unavailable', job_id: null } }) }).render()
    expect(alertOf(off.captured)).toMatchObject({ title: 'vendor.backups.refusal.operations_unavailable' })
    expect(off.captured.some(entry => entry.name === 'UButton' && entry.attrs.to)).toBe(false)
    expect(alertOf((await panel({ data: listing() }).render()).captured)).toBeUndefined()
  })
})

describe('BackupsPanel: starting a backup', () => {
  const buttonOf = (captured: { name: string; attrs: Record<string, unknown> }[]) => captured.find(entry => entry.name === 'UButton' && entry.attrs.type === 'submit')?.attrs
  it('offers no form while the listing says a backup cannot start, or before it loaded', async () => {
    const blocked = await panel({ data: listing({ start: { allowed: false, reason: 'operations_unavailable', job_id: null } }) }).render()
    expect(blocked.html).not.toContain('backup-start'); expect(buttonOf(blocked.captured)).toBeUndefined()
    expect(buttonOf((await panel({ pending: true }).render()).captured)).toBeUndefined()
  })
  it('keeps the button disabled until a reason of 3 to 1000 characters is typed', async () => {
    const { render, state } = panel({ data: listing() })
    expect(buttonOf((await render()).captured)).toMatchObject({ disabled: true })
    for (const reason of ['', '  ', 'ab', 'x'.repeat(1001)]) { state.startReason.value = reason; expect(buttonOf((await render()).captured), JSON.stringify(reason.length)).toMatchObject({ disabled: true }) }
    state.startReason.value = ' Before the upgrade '
    expect(buttonOf((await render()).captured)).toMatchObject({ disabled: false })
  })
  it('keeps the button disabled, and says why, without the permission to run operations', async () => {
    const { render, state } = panel({ data: listing(), capabilities: ['vendor.read'] })
    state.startReason.value = 'Before the upgrade'
    const { captured, html } = await render()
    expect(buttonOf(captured)).toMatchObject({ disabled: true }); expect(html).toContain('vendor.backups.needsPermission')
    state.startBackup(); expect(state.startBusy.value).toBe(false)
  })
  it('sends nothing before the operator confirms the outage', async () => {
    const { render, state, request } = panel({ data: listing() })
    state.startReason.value = 'Before the upgrade'
    state.confirmStart.value = true
    const { captured, html } = await render()
    const confirm = captured.find(entry => entry.name === 'SharedInlineConfirm')!.attrs
    expect(confirm).toMatchObject({ color: 'warning', title: 'vendor.backups.confirmStart', description: 'vendor.backups.outage', 'confirm-label': 'vendor.backups.start' })
    expect(html).not.toContain('<button'); expect(request).not.toHaveBeenCalled()
    state.startReason.value = 'Before the upgrade, edited'
    await Vue.nextTick(); expect(state.confirmStart.value).toBe(false)
  })
  it('posts the reason and a request id only, then opens the operation page', async () => {
    const { state, request, navigateTo, fake } = panel({ data: listing() })
    state.startReason.value = '  Before the upgrade  '
    await state.startBackup()
    expect(request).toHaveBeenCalledTimes(1)
    const [path, options] = request.mock.calls[0] as unknown as [string, { method: string; body: { reason: string; job: { schemaVersion: number; requestId: string; operation: string } } }]
    expect(path).toBe(`shared/tenants/${tenantId}/jobs`); expect(options.method).toBe('POST')
    expect(options.body).toEqual({ reason: 'Before the upgrade', job: { schemaVersion: 1, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), operation: 'backup' } })
    expect(navigateTo).toHaveBeenCalledWith({ path: `/operations/${id(7)}`, query: { source: 'shared', returnTo: `/operations?tenant_id=${tenantId}` } })
    expect(state.startReason.value).toBe('')
    expect(fake.refresh).toHaveBeenCalledTimes(1)
  })
  it('words a cancelled step-up as the person\'s own choice, sends nothing more and keeps the typed reason', async () => {
    const { state, navigateTo, render } = panel({ data: listing(), request: async () => { throw new StepUpCancelled() } })
    state.startReason.value = 'Before the upgrade'
    await state.startBackup()
    expect(navigateTo).not.toHaveBeenCalled(); expect(state.startReason.value).toBe('Before the upgrade')
    const alert = (await render()).captured.find(entry => entry.attrs['data-testid'] === 'backup-start-error')!.attrs
    expect(alert.title).toBe(STEP_UP_CANCELLED_KEY)
  })
  it('sends the same request id again on a retry after a failed answer, and a new one for the next backup', async () => {
    let calls = 0
    const { state, request } = panel({ data: listing(), request: async () => { if (++calls === 1) throw { statusCode: 503, data: { code: 'vendor_unavailable' } }; return { id: id(7) } } })
    state.startReason.value = 'Before the upgrade'
    await state.startBackup(); await state.startBackup()
    const ids = request.mock.calls.map(call => (call[1] as { body: { job: { requestId: string } } }).body.job.requestId)
    expect(ids[0]).toBe(ids[1])
    state.startReason.value = 'Another backup'; await state.startBackup()
    expect((request.mock.calls[2]![1] as { body: { job: { requestId: string } } }).body.job.requestId).not.toBe(ids[0])
  })
  it('reports the typed reason as unsent input, and clears it once sent', async () => {
    const { state } = panel({ data: listing() })
    expect(state.dirtyModel.value).toBe(false)
    state.startReason.value = 'Before the upgrade'; await Vue.nextTick()
    expect(state.dirtyModel.value).toBe(true)
    await state.startBackup(); await Vue.nextTick()
    expect(state.dirtyModel.value).toBe(false)
  })
})

describe('BackupsPanel: restoring from a backup', () => {
  type Call = [string, { method: string; body: Record<string, any> }]
  const actionsOf = (captured: { name: string; attrs: Record<string, unknown> }[]) => captured.filter(entry => entry.name === 'UButton' && entry.attrs['data-action']).map(entry => entry.attrs)
  const answer = (path: string) => (path.endsWith('restore-approvals') ? { approval_id: id(5), expires_at: approval.expires_at } : { id: id(8) })
  const openFor = (backup: ReturnType<typeof panel>, mode: 'resume' | 'restore', reason = 'Restore check') => {
    backup.state.openRestore({ backup_id: id(1), approval: mode === 'resume' ? approval : null }, mode === 'resume')
    backup.state.restoreReason.value = reason
  }
  it('offers one restore per backup without an approval, and nothing without the permission', async () => {
    const withRights = await panel({ data: listing() }).render()
    expect(actionsOf(withRights.captured).map(attrs => [attrs['data-action'], attrs.disabled])).toEqual([['restore', false]])
    expect(actionsOf((await panel({ data: listing(), capabilities: ['vendor.read'] }).render()).captured)).toEqual([])
  })
  it('keeps the restore disabled until a reason of 3 to 1000 characters is typed', async () => {
    const view = panel({ data: listing() })
    openFor(view, 'restore', '')
    const submit = async () => (await view.render()).captured.find(entry => entry.name === 'UButton' && entry.attrs.type === 'submit')!.attrs.disabled
    expect(await submit()).toBe(true)
    view.state.restoreReason.value = 'ab'; expect(await submit()).toBe(true)
    view.state.restoreReason.value = 'Restore check'; expect(await submit()).toBe(false)
  })
  it('asks for a confirmation that says the live workspace is untouched, and sends nothing before it', async () => {
    const view = panel({ data: listing() })
    openFor(view, 'restore'); view.state.confirmRestore.value = true
    const confirm = (await view.render()).captured.find(entry => entry.name === 'SharedInlineConfirm')!.attrs
    expect(confirm).toMatchObject({ title: 'vendor.backups.confirmRestore', description: 'vendor.backups.restoreEffect' })
    expect(view.request).not.toHaveBeenCalled()
  })
  it('approves, then queues the job for that approval, refreshes the list and opens the operation page', async () => {
    const view = panel({ data: listing(), request: async path => answer(path) })
    openFor(view, 'restore'); await view.state.runRestore()
    const calls = view.request.mock.calls as unknown as Call[]
    expect(calls.map(call => call[0])).toEqual([`shared/tenants/${tenantId}/restore-approvals`, `shared/tenants/${tenantId}/jobs`])
    expect(calls[0]![1]).toEqual({ method: 'POST', body: { backup_id: id(1), reason: 'Restore check' } })
    expect(calls[1]![1].body).toEqual({ reason: 'Restore check', job: { schemaVersion: 1, requestId: expect.any(String), operation: 'restore', approvalId: id(5) } })
    expect(view.fake.refresh).toHaveBeenCalledTimes(1)
    expect(view.navigateTo).toHaveBeenCalledWith({ path: `/operations/${id(8)}`, query: { source: 'shared', returnTo: `/operations?tenant_id=${tenantId}` } })
    expect(view.state.restoreTarget.value).toBeNull(); expect(view.state.restoreReason.value).toBe('')
  })
  it('after a failed job call, refreshes so the row can be resumed, and a retry keeps the request id and the approval', async () => {
    let jobCalls = 0
    const view = panel({ data: listing(), request: async path => { if (path.endsWith('/jobs') && ++jobCalls === 1) throw { statusCode: 409, data: { code: 'shared_reconciliation_required' } }; return answer(path) } })
    openFor(view, 'restore')
    await view.state.runRestore()
    expect(view.navigateTo).not.toHaveBeenCalled(); expect(view.fake.refresh).toHaveBeenCalledTimes(1)
    expect(sharedBackupErrorKey(view.state.restoreError.value)).toBe('vendor.backups.errors.shared_reconciliation_required')
    expect(view.state.restoreTarget.value).not.toBeNull(); expect(view.state.restoreReason.value).toBe('Restore check')
    await view.state.runRestore()
    const calls = view.request.mock.calls as unknown as Call[]
    expect(calls.map(call => call[0].split('/').pop())).toEqual(['restore-approvals', 'jobs', 'jobs'])
    expect(calls[2]![1].body.job.requestId).toBe(calls[1]![1].body.job.requestId)
    expect(calls[2]![1].body.job.approvalId).toBe(id(5))
    expect(view.navigateTo).toHaveBeenCalledTimes(1)
  })
  it('offers resume for an open approval and queues the job with that approval alone', async () => {
    const view = panel({ data: listing({ items: [item({ approval })] }), request: async path => answer(path) })
    view.state.now.value = Date.parse(approval.expires_at) - 1000
    expect(actionsOf((await view.render()).captured).map(attrs => [attrs['data-action'], attrs.disabled])).toEqual([['resume', false]])
    openFor(view, 'resume'); await view.state.runRestore()
    expect((view.request.mock.calls as unknown as Call[]).map(call => call[0].split('/').pop())).toEqual(['jobs'])
    expect((view.request.mock.calls[0] as unknown as Call)[1].body.job.approvalId).toBe(id(5))
  })
  it('disables resume once the approval has expired, and offers a new restore instead', async () => {
    const view = panel({ data: listing({ items: [item({ approval })] }) })
    view.state.now.value = Date.parse(approval.expires_at) + 1
    const { captured, html } = await view.render()
    expect(actionsOf(captured).map(attrs => [attrs['data-action'], attrs.disabled])).toEqual([['resume', true], ['restore', false]])
    expect(html).toContain('vendor.backups.approvalExpired')
  })
  it('sends no job call when the step-up for the approval is cancelled', async () => {
    const view = panel({ data: listing(), request: async () => { throw new StepUpCancelled() } })
    openFor(view, 'restore'); await view.state.runRestore()
    expect(view.request).toHaveBeenCalledTimes(1); expect(view.navigateTo).not.toHaveBeenCalled()
    expect(sharedBackupErrorKey(view.state.restoreError.value)).toBe(STEP_UP_CANCELLED_KEY)
  })
  it('counts an unsent restore reason as unsent input', async () => {
    const view = panel({ data: listing() })
    openFor(view, 'restore'); await Vue.nextTick()
    expect(view.state.dirtyModel.value).toBe(true)
    view.state.closeRestore(); await Vue.nextTick()
    expect(view.state.dirtyModel.value).toBe(false)
  })
})
