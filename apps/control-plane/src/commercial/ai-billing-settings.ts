import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { AI_TOPUP_CURRENCY, AI_TOPUP_EXPONENT, CommercialError, aiBillingSettingsInputSchema, aiBillingSettingsSchema, sarMinorToAiUnits,
  type AiBillingSettings, type AiBillingSettingsInput, type AiTopupCatalog } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { aiBillingSettings, convergeAi } from './ai-ledger.js'

const COLUMNS = 'topup_amounts_minor,topup_minimum_minor,usd_rate,trial_allowance_minor,monthly_allowance_minor' as const
const view = (row: Record<string, any>): AiBillingSettings => ({ topup_amounts_minor: (row.topup_amounts_minor as unknown[]).map(Number), topup_minimum_minor: Number(row.topup_minimum_minor),
  usd_rate: String(row.usd_rate), trial_allowance_minor: Number(row.trial_allowance_minor), monthly_allowance_minor: Number(row.monthly_allowance_minor) })
const allowanceUnits = (s: AiBillingSettings) => [sarMinorToAiUnits(s.trial_allowance_minor, s.usd_rate), sarMinorToAiUnits(s.monthly_allowance_minor, s.usd_rate)]

/**
 * The row is the current setting, not a history: every change is audited with its reason and both values. A change that
 * alters what a tenant is delivered (an allowance or the rate that converts it) is pushed to every tenant with an applied
 * subscription inside the same transaction: one small job per tenant, so it scales with the tenant count (thousands are
 * cheap, tens of thousands would want a sweep worker). Tenants that cannot receive it yet get it with their next delivery.
 */
export async function setAiBillingSettings(pool: Pool, input: AiBillingSettingsInput & { operator: string }): Promise<AiBillingSettings & { pushed_tenants: number }> {
  const { operator, ...raw } = input
  const { reason, ...fields } = aiBillingSettingsInputSchema.parse(raw)
  return transaction(pool, async client => {
    const before = (await client.query(`SELECT ${COLUMNS} FROM ai_billing_settings WHERE singleton FOR UPDATE`)).rows[0]
    if (!before) throw new Error('ai_billing_settings_missing')
    const merged = aiBillingSettingsSchema.safeParse({ ...view(before), ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) })
    if (!merged.success) throw new CommercialHttpError('invalid', 422, String(merged.error.issues[0]?.path[0] ?? 'body'))
    const next = merged.data
    // Every figure the settings produce must fit what a tenant can be delivered.
    try { allowanceUnits(next); next.topup_amounts_minor.forEach(a => sarMinorToAiUnits(a, next.usd_rate)) }
    catch (e) { if (e instanceof CommercialError) throw new CommercialHttpError('invalid', 422, 'usd_rate'); throw e }
    const updated = (await client.query(`UPDATE ai_billing_settings SET topup_amounts_minor=$1,topup_minimum_minor=$2,usd_rate=$3,trial_allowance_minor=$4,
      monthly_allowance_minor=$5,updated_by=$6,updated_at=now() WHERE singleton RETURNING ${COLUMNS}`,
    [next.topup_amounts_minor, next.topup_minimum_minor, next.usd_rate, next.trial_allowance_minor, next.monthly_allowance_minor, operator])).rows[0]
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), operator, 'ai_billing.settings_updated', 'ai_billing_settings', reason, JSON.stringify({ before: view(before), after: view(updated) })])
    let pushed = 0
    if (allowanceUnits(view(before)).join() !== allowanceUnits(view(updated)).join()) {
      const customers = (await client.query('SELECT customer_id FROM subscriptions WHERE applied_revision_id IS NOT NULL ORDER BY id')).rows
      for (const { customer_id } of customers) if (await convergeAi(client, customer_id)) pushed++
    }
    return { ...view(updated), pushed_tenants: pushed }
  })
}

/** What the purchase page reads: no amount or rate is hard-coded in the UI. */
export async function aiTopupCatalog(db: Pick<Pool, 'query'>): Promise<AiTopupCatalog> {
  const s = await aiBillingSettings(db)
  return { currency: AI_TOPUP_CURRENCY, exponent: AI_TOPUP_EXPONENT, amounts_minor: s.topup_amounts_minor, minimum_minor: s.topup_minimum_minor, usd_rate: s.usd_rate }
}
