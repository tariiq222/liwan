import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { customerTermsRevisionSchema, type Principal } from '@nasq/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'
import { requireVendor } from './authorization.js'

export async function loadCustomerTerms(client: Pool | PoolClient, customerId: string, revisionId?: string | null) {
  const r = revisionId
    ? await client.query('SELECT * FROM customer_terms_revisions WHERE id=$1 AND customer_id=$2', [revisionId, customerId])
    : await client.query('SELECT * FROM customer_terms_revisions WHERE customer_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [customerId])
  if (!r.rowCount) { if (revisionId) throw new CommercialHttpError('not_found', 404); return null }
  return customerTermsRevisionSchema.parse({ ...r.rows[0].payload, id: r.rows[0].id, customer_id: customerId, reason: r.rows[0].reason })
}
export async function createCustomerTerms(pool: Pool, value: unknown, principal: Principal) {
  requireVendor(principal, 'vendor.pricing.manage', 'vendor.subscriptions.manage')
  const input = customerTermsRevisionSchema.omit({ id: true }).parse(value)
  return transaction(pool, async client => {
    if (!(await client.query('SELECT id FROM customers WHERE id=$1', [input.customer_id])).rowCount) throw new CommercialHttpError('not_found', 404)
    const terms = customerTermsRevisionSchema.parse({ ...input, id: randomUUID() })
    await client.query('INSERT INTO customer_terms_revisions(id,customer_id,payload,reason,created_by) VALUES($1,$2,$3,$4,$5)', [terms.id, terms.customer_id, JSON.stringify(terms), terms.reason, principal.actor_id])
    await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), principal.actor_id, 'customer_terms.created', terms.customer_id, terms.reason, JSON.stringify({ terms_revision_id: terms.id })])
    return terms
  })
}
