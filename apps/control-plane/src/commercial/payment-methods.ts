import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { addCadence, AUTO_RENEW_CONSENT_VERSION, riyadhDate, type AutoRenewSettings } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { PaymentError, type PaymentAdapter } from './payment-adapter.js'
import type { SimulatorMethodOptions } from './payment-simulator.js'
import { openMethodToken, sealMethodToken, simulatorMethodSigningKey, type PaymentMethodKey } from './payment-method-crypto.js'
import { quoteRenewal } from './renewal-quote.js'

const SETUP_MS = 30 * 60_000
const REVOKE_LEASE_MS = 5 * 60_000
type Owner = { customerId: string; tenantId: string; actor: string }
type Query = Pick<PoolClient, 'query'>
export type StoredMethodRuntime = { adapter: PaymentAdapter; key: PaymentMethodKey }
export const storedMethodLockKey = (subscriptionId: string) => `stored-payment-method:${subscriptionId}`

export function simulatorMethodOptions(pool: Pool, key: PaymentMethodKey): SimulatorMethodOptions {
  return {
    signingKey: simulatorMethodSigningKey(key),
    async state(id) {
      return (await pool.query("SELECT state FROM payment_methods WHERE id=$1 AND provider='simulator'", [id])).rows[0]?.state ?? null
    },
  }
}

function providerFor(runtime: StoredMethodRuntime | null | undefined) {
  const provider = runtime?.adapter.mode === 'simulator' && runtime.adapter.storedMethods
  if (!provider) throw new CommercialHttpError('stored_payment_unavailable', 409)
  return provider
}

async function owned(client: Query, owner: Owner) {
  const row = (await client.query(`SELECT s.*,s.renewal_at::text,p.auto_renew_allowed
    FROM subscriptions s JOIN customers c ON c.id=s.customer_id JOIN tenants t ON t.id=s.tenant_id
    LEFT JOIN subscription_revisions sr ON sr.id=s.applied_revision_id
    LEFT JOIN plan_revisions p ON p.id=(sr.snapshot->>'plan_revision_id')::uuid
    WHERE s.customer_id=$1 AND s.tenant_id=$2 AND c.tenant_id=$2 AND t.commercial_mode='saas'`, [owner.customerId,owner.tenantId])).rows[0]
  if (!row) throw new CommercialHttpError('not_found', 404)
  return row
}

async function withOwner<T>(pool: Pool, owner: Owner, action: (client: PoolClient, sub: Record<string, any>) => Promise<T>) {
  return transaction(pool, async client => {
    const initial = await owned(client, owner)
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [storedMethodLockKey(initial.id)])
    const current = await owned(client, owner)
    if (current.id !== initial.id) throw new CommercialHttpError('not_found', 404)
    return action(client, current)
  })
}

const canSetup = (sub: Record<string, any>) => sub.auto_renew_allowed === true && !sub.manual_suspension && sub.trial_ends_at === null
  && ['active','past_due'].includes(sub.state)
const assertEligible = (sub: Record<string, any>) => {
  if (!canSetup(sub)) throw new CommercialHttpError('stored_payment_unavailable', 409)
}

async function closeExpired(client: Query, now: Date, subscriptionId?: string) {
  return client.query(`UPDATE payment_methods SET state='closed',closed_reason='setup_expired',setup_expires_at=NULL
    WHERE state='setup' AND setup_expires_at<=$1 AND ($2::uuid IS NULL OR subscription_id=$2)`, [now,subscriptionId ?? null])
}

export async function expireStoredMethodSetups(pool: Pool, now = new Date()) {
  return (await closeExpired(pool, now)).rowCount ?? 0
}

async function recordMethodEvent(client: Query, actor: string, action: string, method: { id: string; subscription_id: string }) {
  await client.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata)
    VALUES($1,$2,$3,$4,'Stored payment method lifecycle',jsonb_build_object('method_id',$5::text))`,
  [randomUUID(),actor,action,method.subscription_id,method.id])
}

export async function beginStoredMethodSetup(pool: Pool, input: Owner & {
  consentVersion: string; runtime: StoredMethodRuntime | null; clock?: () => number
}) {
  const provider = providerFor(input.runtime)
  if (input.consentVersion !== AUTO_RENEW_CONSENT_VERSION) throw new CommercialHttpError('stored_payment_consent_required', 422)
  const id = await withOwner(pool, input, async (client, sub) => {
    assertEligible(sub)
    const now = new Date((input.clock ?? Date.now)())
    await closeExpired(client, now, sub.id)
    const open = (await client.query("SELECT * FROM payment_methods WHERE subscription_id=$1 AND state IN ('setup','active') FOR UPDATE", [sub.id])).rows[0]
    if (open?.state === 'active') return null
    if (open) {
      if (open.consent_actor !== input.actor || open.consent_version !== AUTO_RENEW_CONSENT_VERSION)
        throw new CommercialHttpError('stored_payment_setup_owned', 409)
      return open.id as string
    }
    const id = randomUUID()
    await client.query(`INSERT INTO payment_methods(id,subscription_id,provider,state,consent_at,consent_actor,consent_version,setup_expires_at)
      VALUES($1,$2,'simulator','setup',$3,$4,$5,$6)`,
    [id,sub.id,now,input.actor,input.consentVersion,new Date(now.getTime()+SETUP_MS)])
    await recordMethodEvent(client, input.actor, 'payment_method.consent', { id, subscription_id: sub.id })
    return id
  })
  if (id) {
    try { await provider.beginSetup(id) }
    catch { throw new CommercialHttpError('stored_payment_setup_unavailable', 409) }
  }
}

async function currentSetup(client: Query, input: Owner & { methodId: string }, sub: Record<string, any>, now: Date) {
  assertEligible(sub)
  const method = (await client.query(`SELECT * FROM payment_methods WHERE id=$1 AND subscription_id=$2 AND provider='simulator'
    AND consent_actor=$3 AND consent_version=$4 FOR UPDATE`, [input.methodId,sub.id,input.actor,AUTO_RENEW_CONSENT_VERSION])).rows[0]
  if (!method) throw new CommercialHttpError('not_found', 404)
  if (method.state === 'active') return null
  if (method.state !== 'setup' || new Date(method.setup_expires_at) <= now)
    throw new CommercialHttpError('stored_payment_setup_expired', 409)
  return method
}

export async function completeStoredMethodSetup(pool: Pool, input: Owner & {
  methodId: string; runtime: StoredMethodRuntime | null; clock?: () => number
}) {
  const provider = providerFor(input.runtime), key = input.runtime!.key
  const now = () => new Date((input.clock ?? Date.now)())
  const pending = await withOwner(pool, input, (client, sub) => currentSetup(client,input,sub,now()))
  if (!pending) return
  let token: string
  try { token = await provider.completeSetup(pending.id) }
  catch {
    if (!await withOwner(pool,input,(client,sub) => currentSetup(client,input,sub,now()))) return
    throw new CommercialHttpError('stored_payment_setup_unavailable', 409)
  }
  await withOwner(pool, input, async (client, sub) => {
    const method = await currentSetup(client,input,sub,now())
    if (!method) return
    const ciphertext = sealMethodToken(key, method, token)
    await client.query(`UPDATE payment_methods SET state='active',activated_at=$2,setup_expires_at=NULL,token_ciphertext=$3,key_id=$4
      WHERE id=$1 AND state='setup'`, [method.id,now(),ciphertext,key.id])
    await recordMethodEvent(client, input.actor, 'payment_method.activated', method)
  })
}

async function stopUnsent(client: Query, methodId: string, now: Date, reason: 'off' | 'method_closed') {
  await client.query("UPDATE renewal_notices SET state='void',void_reason=$2 WHERE method_id=$1 AND state='due'", [methodId,reason])
  await client.query(`UPDATE payment_attempts SET status='canceled',closed_reason='method_off',resolved_at=$2,updated_at=$2
    WHERE method_id=$1 AND token_charge AND status='created'`, [methodId,now])
}

export async function turnOffStoredMethod(pool: Pool, input: Owner & { clock?: () => number }) {
  await withOwner(pool, input, async (client, sub) => {
    const method = (await client.query("SELECT * FROM payment_methods WHERE subscription_id=$1 AND state IN ('setup','active') FOR UPDATE", [sub.id])).rows[0]
    if (!method) return
    const now = new Date((input.clock ?? Date.now)())
    if (method.state === 'setup') {
      await client.query("UPDATE payment_methods SET state='closed',closed_reason='setup_cancelled',setup_expires_at=NULL WHERE id=$1", [method.id])
    } else {
      await client.query("UPDATE payment_methods SET state='revoking',revoke_next_at=$2 WHERE id=$1", [method.id,now])
      await stopUnsent(client, method.id, now, 'off')
    }
    await recordMethodEvent(client, input.actor, 'payment_method.off', method)
  })
}

export async function markStoredMethodInvalid(pool: Pool, methodId: string, keyId: string, now: Date) {
  await transaction(pool, async client => {
    const method = (await client.query("SELECT subscription_id FROM payment_methods WHERE id=$1", [methodId])).rows[0]
    if (!method) return
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [storedMethodLockKey(method.subscription_id)])
    const closed = (await client.query(`UPDATE payment_methods SET state='closed',closed_reason='invalid',token_ciphertext=NULL,key_id=NULL
      WHERE id=$1 AND state='active' AND key_id=$2 RETURNING id,subscription_id`, [methodId,keyId])).rows[0]
    if (!closed) return
    await stopUnsent(client, methodId, now, 'method_closed')
    await recordMethodEvent(client, 'system', 'payment_method.invalid', closed)
  })
}

export async function processStoredMethodRevocations(pool: Pool, input: {
  runtime: StoredMethodRuntime; clock?: () => number; signal?: AbortSignal
}) {
  const provider = providerFor(input.runtime), clock = input.clock ?? Date.now
  const due = (await pool.query("SELECT id FROM payment_methods WHERE state='revoking' AND provider='simulator' AND revoke_next_at<=$1 ORDER BY revoke_next_at,id LIMIT 20",
    [new Date(clock())])).rows
  let completed = 0
  for (const { id } of due) {
    if (input.signal?.aborted) break
    const now = new Date(clock()), lease = new Date(now.getTime()+REVOKE_LEASE_MS)
    const row = (await pool.query(`UPDATE payment_methods SET revoke_next_at=$2 WHERE id=$1 AND state='revoking'
      AND revoke_next_at<=$3 RETURNING *`, [id,lease,now])).rows[0]
    if (!row) continue
    let removed = false
    try {
      await provider.deleteToken(openMethodToken(input.runtime.key,row))
      removed = true
    } catch (error) { removed = error instanceof PaymentError && error.code === 'not_found' }
    if (removed) {
      completed += await transaction(pool, async client => {
        const closed = (await client.query(`UPDATE payment_methods SET state='closed',closed_reason='revoked',token_ciphertext=NULL,key_id=NULL,revoke_next_at=NULL
          WHERE id=$1 AND state='revoking' AND revoke_next_at=$2 RETURNING id,subscription_id`, [id,lease])).rows[0]
        if (!closed) return 0
        await recordMethodEvent(client, 'system', 'payment_method.revoked', closed)
        return 1
      })
    } else {
      const retryMs = Math.min(2 ** Math.min(row.revoke_attempts,11),24*60)*60_000
      await pool.query(`UPDATE payment_methods SET revoke_attempts=revoke_attempts+1,revoke_next_at=$3
        WHERE id=$1 AND state='revoking' AND revoke_next_at=$2`, [id,lease,new Date(clock()+retryMs)])
    }
  }
  return completed
}

export async function storedMethodView(pool: Pool, sub: Record<string, any>, keyId?: string): Promise<AutoRenewSettings> {
  const snapshot = (await pool.query(`SELECT r.snapshot,p.auto_renew_allowed FROM subscription_revisions r
    JOIN plan_revisions p ON p.id=(r.snapshot->>'plan_revision_id')::uuid WHERE r.id=$1`, [sub.applied_revision_id])).rows[0]
  const available = Boolean(keyId && canSetup({ ...sub, auto_renew_allowed: snapshot?.auto_renew_allowed }))
  const method = (await pool.query(`SELECT id,state,consent_at,setup_expires_at,closed_reason,key_id FROM payment_methods
    WHERE subscription_id=$1 ORDER BY (state IN ('setup','active')) DESC,consent_at DESC,id DESC LIMIT 1`, [sub.id])).rows[0]
  if (method?.state === 'setup' && new Date(method.setup_expires_at) > new Date()) return {
    state: 'setup', available, setup_id: method.id, consent_at: new Date(method.consent_at).toISOString(), setup_expires_at: new Date(method.setup_expires_at).toISOString(),
  }
  if (method?.state !== 'active') return { state: method?.closed_reason === 'invalid' ? 'needs_new_method' : 'off', available }
  const ready = available && method.key_id === keyId
  let nextCharge: Extract<AutoRenewSettings, { state: 'on' }>['next_charge'] = null
  if (ready && sub.renewal_at && !sub.target_revision_id) {
    const now = new Date(), start = sub.renewal_at as string
    if (start >= riyadhDate(now)) {
      const period = { start, end: addCadence(start,snapshot.snapshot.cadence,1) }
      const { quote } = await quoteRenewal(pool,sub,snapshot.snapshot,period,now)
      if (quote.due_now.minor > 0) {
        const amount = quote.due_now
        const notice = (await pool.query(`SELECT sent_at FROM renewal_notices WHERE method_id=$1 AND renewal_date=$2
          AND amount_minor=$3 AND currency=$4 AND exponent=$5 AND cadence_unit=$6 AND cadence_count=$7 AND state='sent'`,
        [method.id,start,amount.minor,amount.currency,amount.exponent,quote.cadence.unit,quote.cadence.count])).rows[0]
        nextCharge = { date: start, amount, notice_sent_at: notice?.sent_at ? new Date(notice.sent_at).toISOString() : null }
      }
    }
  }
  return { state: 'on', available: ready, consent_at: new Date(method.consent_at).toISOString(), method_label: 'simulator', next_charge: nextCharge }
}
