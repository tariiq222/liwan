import type { Pool } from 'pg'
import type { Config } from '../config.js'
import { processFulfillmentOutbox } from './fulfillment.js'
import { claimOutbox, completeOutbox, failOutbox } from './outbox.js'
import { onSubscriptionActivated, sendInvitationOutbox } from './invitations.js'
import { reconcileUnknownAttempts } from './payments.js'
import { recoverInterrupted } from '../shared/subscription-reconcile.js'
import { generateRenewals, applyDunning } from './renewals.js'
import * as settlements from './settlements.js'
import type { PaymentAdapter } from './payment-adapter.js'
import type { MailAdapter } from './mail-adapter.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadSharedRuntimeConfig } from '../shared/runtime-config.js'
import { collectUsage, FRESH_MS, type UsageObserveRunner } from './usage-collector.js'

type Env = Record<string, string | undefined>
export type CommercialSchedulerOptions = {
  pool: Pool; config: Config; env: Env; clock?: () => number
  paymentAdapter?: PaymentAdapter; mailAdapter?: MailAdapter
  subscriptionRunner?: Parameters<typeof recoverInterrupted>[1] extends infer O ? (O extends { runner?: infer R } ? R : never) : never
  usageRunner?: UsageObserveRunner
  /** Worker shutdown: stops the background usage run before its next target. */
  signal?: AbortSignal
  log?: (message: string, err?: unknown) => void
}

/** A usage run may use 80% of the interval, so the next one starts on time and a tenant is revisited about every interval. */
export const usageBudgetMs = (intervalMs: number) => Math.floor(intervalMs * 0.8)

/** A tenant sampled at the start of one run and at the end of the next is INTERVAL + BUDGET (1.8 x interval) apart;
 * that must stay inside the freshness window (500 s for 15 min), or a downgrade check can find no fresh sample. */
export const USAGE_MAX_INTERVAL_MS = Math.floor(FRESH_MS / 1.8)

const posInt = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d }

/** True while the shared runtime is owned by someone else: the runtime-gate directory exists, or a shared
 * provision/backup/restore job is claimed (state 'running'). Reads only; a read failure counts as busy. */
export function sharedRuntimeBusy(pool: Pool, config: Config, log?: (message: string, error?: unknown) => void): () => Promise<boolean> {
  return async () => {
    if (config.sharedRuntimeConfigPath) {
      let stateDir: string
      // An unreadable runtime config still pauses collection, but it is logged as what it is.
      try { stateDir = loadSharedRuntimeConfig(config.sharedRuntimeConfigPath).stateDir }
      catch (error) { try { log?.('invalid shared runtime config; usage collection stays paused', error) } catch { /* never throw */ } return true }
      if (existsSync(join(stateDir, 'runtime-gate'))) return true
    }
    return ((await pool.query("SELECT 1 FROM shared_jobs WHERE state='running' LIMIT 1")).rowCount ?? 0) > 0
  }
}

export function createCommercialScheduler(o: CommercialSchedulerOptions) {
  const { pool, config, env } = o
  const clock = o.clock ?? Date.now
  const log = o.log ?? ((m: string, e?: unknown) => console.error(`[commercial-scheduler] ${m}`, e instanceof Error ? e.message : e ?? ''))
  const reconcileEvery = posInt(env.NASQ_COMMERCIAL_RECONCILE_EVERY, 10)
  // Downgrade checks need a sample younger than 15 minutes (usage.ts): the interval defaults to 5 minutes and is capped at USAGE_MAX_INTERVAL_MS.
  const usageMs = Math.min(posInt(env.NASQ_COMMERCIAL_USAGE_INTERVAL_SEC, 300) * 1000, USAGE_MAX_INTERVAL_MS)
  let nextUsage = 0
  let lockSkipLogged = false
  const USAGE_RETRY_MS = 30_000
  let usageRun: Promise<void> | undefined
  const billingMs = posInt(env.NASQ_COMMERCIAL_BILLING_INTERVAL_SEC, 3600) * 1000
  const origin = (env.NASQ_PAYMENT_RETURN_ORIGINS ?? '').split(',')[0]?.trim() ?? ''
  let ticks = 0
  let lastBilling: number | undefined
  let jobCounts: Record<string, { runs: number; failures: number }> = {}
  const job = async (name: string, fn: () => Promise<unknown>) => {
    const counts = jobCounts[name] ??= { runs: 0, failures: 0 }
    counts.runs++
    try { await fn() } catch (e) { counts.failures++; try { log(`${name} failed`, e) } catch { /* never throw */ } }
  }

  return {
    /** Resolves when the background usage run in flight (if any) has ended. */
    async usageIdle(): Promise<void> { await usageRun },
    async tick(): Promise<void> {
      ticks++
      jobCounts = {}
      await job('fulfillment', () => processFulfillmentOutbox(pool, { limit: 20, enrollment: { config } }))
      await job('invitation.issue', async () => {
        for (const row of await claimOutbox(pool, ['invitation.issue'], 20)) {
          try {
            await onSubscriptionActivated(pool, (row.payload as { subscription_id: string }).subscription_id)
            await completeOutbox(pool, row.id)
          } catch (e) { await failOutbox(pool, row.id, e instanceof Error ? e.message.slice(0, 200) : 'issue_failed') }
        }
      })
      if (o.mailAdapter) {
        const mail = o.mailAdapter
        await job('invitation.send', () => sendInvitationOutbox(pool, { mail, origin, smtpHost: env.NASQ_MAIL_SMTP_HOST }))
      }
      if (ticks % reconcileEvery === 0) {
        if (o.paymentAdapter) {
          const adapter = o.paymentAdapter
          await job('reconcile-payments', async () => {
            const results = await reconcileUnknownAttempts(pool, adapter, { clock })
            const failures: Record<string, number> = {}
            for (const result of results) {
              if (result.outcome !== 'accepted' && result.outcome !== 'ignored')
                failures[result.outcome] = (failures[result.outcome] ?? 0) + 1
            }
            if (Object.keys(failures).length) throw new Error(`payment_reconciliation_incomplete ${JSON.stringify(failures)}`)
          })
        }
        await job('recover-interrupted', () => recoverInterrupted(pool, { runner: o.subscriptionRunner }))
      }
      const now = clock()
      // Usage collection talks to Odoo, so it runs in the background (single flight) and never holds a tick.
      if (o.usageRunner && !usageRun && now >= nextUsage && !o.signal?.aborted) {
        nextUsage = now + usageMs
        const runner = o.usageRunner
        usageRun = collectUsage(pool, { runner, signal: o.signal, budget_ms: usageBudgetMs(usageMs), busy: sharedRuntimeBusy(pool, config, log) }).then(r => {
          // Another worker is collecting: retry soon rather than a full interval later.
          if (r.locked || r.busy) { nextUsage = clock() + USAGE_RETRY_MS; if (!lockSkipLogged) { lockSkipLogged = true; try { log(r.busy ? 'usage paused: a shared runtime job is running' : 'usage skipped: another collector holds the lock') } catch { /* never throw */ } } }
          else lockSkipLogged = false
        }, e => { try { log('usage failed', e) } catch { /* never throw */ } }).finally(() => { usageRun = undefined })
      }
      if (lastBilling === undefined || now - lastBilling >= billingMs) {
        lastBilling = now
        if (o.paymentAdapter) {
          const adapter = o.paymentAdapter
          await job('renewals', () => generateRenewals(pool, { now: new Date(now), adapter, allowedOrigin: origin, return_path: '/subscription/status' }))
        }
        await job('dunning', () => applyDunning(pool, { now: new Date(now) }))
        const refund = (settlements as Record<string, unknown>).processRefundOutbox
        if (typeof refund === 'function') await job('refunds', () => (refund as (p: Pool) => Promise<unknown>)(pool))
      }
      console.debug(JSON.stringify({ event: 'commercial_scheduler_tick', tick: ticks, jobs: jobCounts }))
    },
  }
}
