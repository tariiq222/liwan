import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { disableAutoRenew } from './auto-renew.js'
import type { PaymentAdapter } from './payment-adapter.js'

type Remover = { by: 'customer' | 'vendor'; actor: string; reason: string | null }

/**
 * Removes a saved card. Under the subscription row lock the token is deleted at the provider first, and only then is the row marked removed
 * (and, for the default card, automatic renewal turned off): while the provider may still hold a chargeable token the card stays active
 * and the call answers an error. Asking again for a removed card changes nothing.
 */
export async function removePaymentMethod(pool: Pool, adapter: PaymentAdapter, input: Remover & { customer_id: string; payment_method_id: string }): Promise<void> {
  await transaction(pool, async client => {
    const sub = (await client.query('SELECT id FROM subscriptions WHERE customer_id=$1 FOR UPDATE', [input.customer_id])).rows[0]
    const method = (await client.query('SELECT * FROM payment_methods WHERE id=$1 AND customer_id=$2 FOR UPDATE', [input.payment_method_id, input.customer_id])).rows[0]
    if (!sub || !method) throw new CommercialHttpError('not_found', 404)
    if (method.status === 'removed') return
    if (method.provider !== adapter.provider || method.mode !== adapter.mode) throw new CommercialHttpError('provider_mismatch', 409)
    try { await adapter.deleteToken(method.provider_token) }
    catch (error) {
      console.error(JSON.stringify({ event: 'payment_method_removal_failed', payment_method_id: method.id, error: (error as { code?: string })?.code ?? 'error' }))
      throw new CommercialHttpError('provider_unavailable', 503)
    }
    await client.query("UPDATE payment_methods SET status='removed',is_default=false,provider_token=NULL,removed_at=now(),removed_by=$2 WHERE id=$1", [method.id, input.by])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), input.actor, 'payment_method.removed', sub.id, input.reason ?? '', JSON.stringify({ payment_method_id: method.id, by: input.by, brand: method.brand, last_four: method.last_four })])
    // The default card is the one automatic renewal charges: without it nothing may be charged.
    if (method.is_default) await disableAutoRenew(client, sub.id, { actor: input.actor, reason: input.reason ?? 'The saved card was removed' })
  })
}
