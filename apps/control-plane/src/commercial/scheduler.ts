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
import { collectUsage, type UsageObserveRunner } from './usage-collector.js'

type Env = Record<string, string | undefined>
export type CommercialSchedulerOptions = {
  pool: Pool; config: Config; env: Env; clock?: () => number
  paymentAdapter?: PaymentAdapter; mailAdapter?: MailAdapter
  subscriptionRunner?: Parameters<typeof recoverInterrupted>[1] extends infer O ? (O extends { runner?: infer R } ? R : never) : never
  usageRunner?: UsageObserveRunner
  log?: (message: string, err?: unknown) => void
}

const posInt = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d }

export function createCommercialScheduler(o: CommercialSchedulerOptions) {
  const { pool, config, env } = o
  const clock = o.clock ?? Date.now
  const log = o.log ?? ((m: string, e?: unknown) => console.error(`[commercial-scheduler] ${m}`, e instanceof Error ? e.message : e ?? ''))
  const reconcileEvery = posInt(env.NASQ_COMMERCIAL_RECONCILE_EVERY, 10)
  // Downgrade checks need a sample younger than 15 minutes (usage.ts); keep ticks × interval below that.
  const usageEvery = posInt(env.NASQ_COMMERCIAL_USAGE_EVERY, 10)
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
        if (o.paymentAdapter) { const a = o.paymentAdapter; await job('reconcile-payments', () => reconcileUnknownAttempts(pool, a)) }
        await job('recover-interrupted', () => recoverInterrupted(pool, { runner: o.subscriptionRunner }))
      }
      if (o.usageRunner && ticks % usageEvery === 0) {
        const runner = o.usageRunner
        await job('usage', () => collectUsage(pool, { runner }))
      }
      const now = clock()
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
