import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { deletionWithdrawable, isDeletionShown, stuckParts } from '../../utils/vendorDeletion'
import type { TenantDeletionRequest } from '@liwan/commercial-contracts'
import { loadSfc } from './sfc'

const request = (over: Partial<TenantDeletionRequest> = {}): TenantDeletionRequest => ({
  id: '00000000-0000-4000-8000-000000000001', customer_id: '00000000-0000-4000-8000-000000000002', state: 'deleting', requested_at: '2027-01-01T09:00:00Z', requested_by: 'a@b.sa',
  confirmed_at: '2027-01-01T09:05:00Z', due_at: '2027-04-01T09:05:00Z', due_marked_at: '2027-04-01T09:06:00Z', withdrawn_at: null, withdrawn_by: null, withdraw_reason: null,
  renewal_outcome: 'cancelled', renewal_refusal: null, hold_until: '2027-04-04T09:06:00Z', deleting_at: '2027-04-04T09:07:00Z', committed_at: null, deleted_at: null, stuck_at: null, stuck_code: null, ...over,
})
const step = (name: string, over: Record<string, unknown> = {}) => ({ step: name, state: 'done', intent: null, attempts: 1, failures: 0, started_at: null, finished_at: null, next_attempt_at: null, error_code: null, evidence: {}, ...over })
const run = (over: Record<string, unknown> = {}) => ({ request: request(), enabled: true, plan: { digest: 'd', database: 'liwan_acme', host: 'acme.example.sa', backups: 3, restore_copies: 1, cards: 2 }, prechecks: { blocked_by: null, checks: [{ code: 'no_open_invoice', ok: true }] }, steps: [step('preflight'), step('stop_access')], ...over })
const sfc = loadSfc('components/vendor/DeletionRunPanel.vue', { useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }), formatLiwanDateTime: (value: string) => `@${value}`, stuckParts })

describe('DeletionRunPanel', () => {
  it('shows the runner state, the dates, the frozen plan, the checks and the ledger, read-only', async () => {
    const html = await sfc.html({ run: run() })
    expect(html).toContain('vendor.customers.deletion.run.runnerOn')
    for (const date of ['@2027-04-04T09:06:00Z', '@2027-04-04T09:07:00Z']) expect(html).toContain(date)
    expect(html).toContain('liwan_acme'); expect(html).toContain('acme.example.sa')
    expect(html).toContain('data-testid="deletion-precheck"'); expect(html).toContain('no_open_invoice')
    expect(html.match(/data-testid="deletion-step"/g)).toHaveLength(2)
    expect(html).toContain('vendor.customers.deletion.run.stepNames.stop_access')
    expect(html).toContain('vendor.customers.deletion.run.notCommitted')
    expect(html).not.toMatch(/<button|<form|<input/)
  })
  it('says the runner is off and that no plan exists yet', async () => {
    const html = await sfc.html({ run: run({ enabled: false, plan: null, steps: [], prechecks: { blocked_by: null, checks: [] }, request: request({ state: 'due', deleting_at: null }) }) })
    expect(html).toContain('vendor.customers.deletion.run.runnerOff')
    expect(html).toContain('data-testid="deletion-no-plan"'); expect(html).toContain('data-testid="deletion-no-steps"')
    expect(html).not.toContain('data-testid="deletion-point-of-no-return"')
  })
  it('says why the runner is off (a local mail capture) and shows the restore hold when it applies', async () => {
    const off = await sfc.html({ run: run({ enabled: false, disabled_reason: 'local_mail_capture' }) })
    expect(off).toContain('vendor.customers.deletion.run.runnerOffReasons.local_mail_capture')
    expect(off).not.toContain('vendor.customers.deletion.run.restoreHold')
    const held = await sfc.html({ run: run({ restore_hold_until: '2027-04-07T09:00:00Z' }) })
    expect(held).toContain('vendor.customers.deletion.run.restoreHold')
  })
  it('names the stuck step and code, a failed step with its last error, and the passed point of no return', async () => {
    const html = await sfc.html({ run: run({ request: request({ committed_at: '2027-04-04T09:20:00Z', stuck_at: '2027-04-05T09:00:00Z', stuck_code: 'purge_offsite:offsite_not_empty' }), steps: [step('purge_offsite', { state: 'failed', failures: 5, attempts: 5, error_code: 'offsite_not_empty', next_attempt_at: '2027-04-05T15:00:00Z' })] }) })
    expect(html).toContain('vendor.customers.deletion.run.stuck {"step":"vendor.customers.deletion.run.stepNames.purge_offsite","code":"offsite_not_empty"}'.replaceAll('"', '&quot;'))
    expect(html).toContain('vendor.customers.deletion.run.committed')
    expect(html).toContain('data-testid="deletion-step-error"')
    expect(html).toContain('data-state="failed"')
  })
})

describe('vendorDeletion', () => {
  it('lets the vendor withdraw until the point of no return and no later', () => {
    for (const state of ['requested', 'confirmed', 'due']) expect(deletionWithdrawable(request({ state: state as TenantDeletionRequest['state'] })), state).toBe(true)
    expect(deletionWithdrawable(request({ state: 'deleting', committed_at: null }))).toBe(true)
    expect(deletionWithdrawable(request({ state: 'deleting', committed_at: '2027-04-04T09:20:00Z' }))).toBe(false)
    expect(deletionWithdrawable(request({ state: 'deleted', committed_at: '2027-04-04T09:20:00Z' }))).toBe(false)
    expect(deletionWithdrawable(request({ state: 'withdrawn' }))).toBe(false)
  })
  it('shows open and finished requests and hides a withdrawn or missing one', () => {
    for (const state of ['requested', 'confirmed', 'due', 'deleting', 'deleted']) expect(isDeletionShown(request({ state: state as TenantDeletionRequest['state'] })), state).toBe(true)
    expect(isDeletionShown(request({ state: 'withdrawn', deleting_at: null }))).toBe(false)
    // A withdrawal after access was stopped stays visible: its reinstatement is not done until the workspace is back.
    expect(isDeletionShown(request({ state: 'withdrawn', deleting_at: '2026-11-14T09:00:00.000Z' }))).toBe(true)
    expect(isDeletionShown(null)).toBe(false)
  })
  it('reads the stuck step only when it is a known step', () => {
    expect(stuckParts(request({ stuck_code: 'purge_offsite:offsite_not_empty' }))).toEqual({ step: 'purge_offsite', code: 'offsite_not_empty' })
    expect(stuckParts(request({ stuck_code: 'unknown_step:x' }))).toEqual({ step: null, code: 'unknown_step:x' })
    expect(stuckParts(request({ stuck_code: 'restore_recent' }))).toEqual({ step: null, code: 'restore_recent' })
    expect(stuckParts(request())).toBeNull()
  })
})
