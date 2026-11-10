import { describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { createCommercialScheduler } from '../commercial/scheduler.js'
import { sendInvitationOutbox } from '../commercial/invitations.js'
import { sendTrialNotices } from '../commercial/trial-notices.js'
import { trialEndPreview } from '../commercial/trial-preview.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import type { MailAdapter, MailMessage } from '../commercial/mail-adapter.js'

vi.mock('../commercial/trial-preview.js', () => ({ trialEndPreview: vi.fn() }))

type Call = { sql: string; params: unknown[] }
const recordingPool = (answer: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }) => {
  const calls: Call[] = []
  const pool = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql: String(sql), params }); const r = answer(String(sql), params); return { rowCount: r.rows.length, ...r } } }
  return { pool, calls }
}
const abortingMail = (controller: AbortController) => {
  const sent: MailMessage[] = []
  const mail: MailAdapter = { async send(m) { sent.push(m); controller.abort(); return { accepted: true, provider_message_id: `p-${m.message_id}` } } }
  return { mail, sent }
}

const recoveryScan = (sql: string) => sql.startsWith('SELECT id,subscription_id FROM orders o WHERE')
  && sql.includes('fulfillment_retry_at')
const noticeNow = new Date('2026-11-10T09:00:00Z')
const noticeEnd = new Date(noticeNow.getTime() + 86_400_000)
const noticeLease = '2026-11-10 09:05:00.123456+00'
const noticePreview: Awaited<ReturnType<typeof trialEndPreview>> = {
  status: 'trialing', trial_ends_at: noticeEnd.toISOString(), outcome: null,
  kept: { bundle_revision_ids: [], paid_users: 0, paid_storage_gb: 0, paid_extra_branches: 0 },
  locked_bundle_revision_ids: [], limits: { users: 3, storage_mb: 1024, extra_branches: 0 },
  excess: { users: null, storage_bytes: null, extra_branches: null, sampled_at: null, source: 'unavailable', item_details: 'unavailable' },
  first_invoice: null, next_attempt_at: null,
}

function noticeFixture(controller: AbortController, stopAfter?: 'lease' | 'preview' | 'preview-error') {
  const row = (id: string) => ({ id, trial_ends_at: noticeEnd, customer_id: 'c', trial_days: 14,
    snapshot: { quote_id: 'q', terms_revision_id: 'negotiated' }, admin_login: `${id}@x.test` })
  vi.mocked(trialEndPreview).mockReset().mockImplementation(async () => {
    if (stopAfter !== undefined && stopAfter !== 'lease') controller.abort()
    if (stopAfter === 'preview-error') throw new Error('preview interrupted')
    return noticePreview
  })
  return recordingPool(sql => {
    if (sql.includes('FROM subscriptions s')) return { rows: [row('s1'), row('s2')] }
    if (sql.includes('INSERT INTO commercial_outbox')) return { rows: [{ id: 'new' }] }
    if (sql.includes('SELECT id,status FROM commercial_outbox')) return { rows: [{ id: 'outbox-1', status: 'pending' }] }
    if (sql.includes("SET next_attempt_at = now() + interval '5 minutes' WHERE id=$1")) {
      if (stopAfter === 'lease') controller.abort()
      return { rows: [{ lease_until: noticeLease }], rowCount: 1 }
    }
    return { rows: [] }
  })
}

describe('worker shutdown during a scheduler tick', () => {
  it('finishes the invitation in flight, sends no further one and gives the other leases back', async () => {
    const controller = new AbortController()
    const claimed = ['a', 'b', 'c'].map((id, n) => ({ id: `row-${id}`, created_at: new Date(1000 + n),
      payload: { invitation_id: `inv-${id}`, token: `token-${id}` } }))
    const { pool, calls } = recordingPool(sql => {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) return { rows: claimed }
      if (sql.includes('FROM admin_invitations')) return { rows: [{ admin_login: 'admin@x.test', customer_id: 'c1', name: 'شركة' }] }
      return { rows: [] }
    })
    const { mail, sent } = abortingMail(controller)
    const result = await sendInvitationOutbox(pool as never, { mail, returnOrigin: fixedReturnOrigin('https://app.liwan.test'), signal: controller.signal })
    expect(result).toEqual({ sent: 1, failed: 0 })
    expect(sent.map(m => m.message_id)).toEqual(['inv-a@liwan'])
    const completed = calls.filter(c => c.sql.includes("status='done'")).map(c => c.params[0])
    const released = calls.filter(c => c.sql.includes('SET next_attempt_at = now() WHERE')).map(c => c.params[0])
    expect(completed).toEqual(['row-a'])
    expect(released).toEqual(['row-b', 'row-c'])
  })

  it('queues and sends no further trial notice after the signal', async () => {
    const controller = new AbortController()
    const { pool, calls } = noticeFixture(controller)
    const { mail, sent } = abortingMail(controller)
    await sendTrialNotices(pool as never, { now: noticeNow, mail, signal: controller.signal })
    expect(sent).toHaveLength(1)
    expect(calls.filter(c => c.sql.includes('INSERT INTO commercial_outbox'))).toHaveLength(1)
  })

  it.each(['lease', 'preview', 'preview-error'] as const)('releases the unsent notice when shutdown arrives during %s', async stopAfter => {
    const controller = new AbortController()
    const { pool, calls } = noticeFixture(controller, stopAfter)
    const { mail, sent } = abortingMail(controller)
    expect(await sendTrialNotices(pool as never, { now: noticeNow, mail, signal: controller.signal })).toBe(0)
    expect(sent).toEqual([])
    const releases = calls.filter(c => c.sql.includes('SET next_attempt_at = now() WHERE'))
    expect(releases.map(c => c.params)).toEqual([['outbox-1', noticeLease]])
    expect(releases[0].sql).toContain('AND next_attempt_at=$2::timestamptz')
    expect(calls.filter(c => c.sql.includes("status='done'"))).toEqual([])
    expect(vi.mocked(trialEndPreview)).toHaveBeenCalledTimes(stopAfter === 'lease' ? 0 : 1)
  })

  it('starts no job in a tick once the signal is set, and none after the job in flight', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const controller = new AbortController()
    const { pool, calls } = recordingPool(sql => {
      if (recoveryScan(sql)) controller.abort() // the signal arrives during the actual first job
      return { rows: [] }
    })
    const scheduler = createCommercialScheduler({ pool: pool as never, config: {} as never, env: {}, log: () => {}, signal: controller.signal,
      mailAdapter: { async send() { throw new Error('no mail may be sent') } } })
    await scheduler.tick()
    expect(calls).toHaveLength(1)
    expect(recoveryScan(calls[0].sql)).toBe(true)

    calls.length = 0
    await scheduler.tick() // already aborted: nothing starts at all
    expect(calls).toEqual([])
  })

  it.each(['fulfillment.enqueue', 'invitation.issue'])('gives every claimed %s row back when the signal arrives with the batch', async kind => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const controller = new AbortController()
    const claimed = ['a', 'b'].map((id, n) => ({ id: `row-${id}`, created_at: new Date(1000 + n), aggregate_id: `agg-${id}`, payload: { subscription_id: `sub-${id}` } }))
    const { pool, calls } = recordingPool((sql, params) => {
      if (sql.includes('FOR UPDATE SKIP LOCKED') && (params[0] as string[]).includes(kind)) { controller.abort(); return { rows: claimed } }
      return { rows: [] }
    })
    const scheduler = createCommercialScheduler({ pool: pool as never, config: {} as never, env: {}, log: () => {}, signal: controller.signal })
    await scheduler.tick()
    const released = calls.filter(c => c.sql.includes('SET next_attempt_at = now() WHERE')).map(c => c.params[0])
    expect(released).toEqual(['row-a', 'row-b'])
    // The first job did its read-only recovery scan; the stopped batch only claimed and released.
    expect(recoveryScan(calls[0].sql)).toBe(true)
    expect(calls.filter(c => !c.sql.includes('FOR UPDATE SKIP LOCKED') && !c.sql.includes('SET next_attempt_at = now() WHERE'))).toEqual([calls[0]])
    const stoppedClaim = calls.findIndex(c => c.sql.includes('FOR UPDATE SKIP LOCKED') && (c.params[0] as string[]).includes(kind))
    expect(calls.slice(stoppedClaim + 1).map(c => c.params[0])).toEqual(['row-a', 'row-b'])
  })
})

describe('shutdown signal handler', () => {
  it('survives a repeated signal, so a repeated stop cannot end a worker mid-operation', async () => {
    const root = new URL('../..', import.meta.url).pathname
    const code = `import { onShutdownSignal } from './src/shutdown.ts'
let seen = 0
onShutdownSignal(() => { process.stdout.write('got ' + (++seen) + '\\n') })
process.stdout.write('ready\\n')
setTimeout(() => process.exit(0), 5000)`
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', d => { out += d })
    const until = (text: string) => new Promise<void>(resolve => { const t = setInterval(() => { if (out.includes(text)) { clearInterval(t); resolve() } }, 10) })
    const exited = new Promise<number | null>(resolve => child.once('exit', (code, signal) => resolve(signal ? null : code)))
    await until('ready')
    child.kill('SIGTERM'); await until('got 1')
    child.kill('SIGTERM'); await until('got 2')
    child.kill('SIGKILL')
    await exited
    expect(out).toContain('got 2')
  })
})
