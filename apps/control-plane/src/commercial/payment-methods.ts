import type { Pool, PoolClient } from 'pg'
import type { PaymentMethodView } from '@liwan/commercial-contracts'

type Queryable = Pick<Pool | PoolClient, 'query'>

/** A saved card row, token included: for the control plane's own charging code only, never for a view, an audit row or a log. */
export type PaymentMethodRow = {
  id: string; customer_id: string; provider: string; mode: string; provider_token: string
  brand: string; last_four: string; exp_month: number; exp_year: number; status: string; is_default: boolean
}

/** The rows that count as the customer's default method: the one default row that is active. */
const DEFAULT_PAYMENT_METHOD_WHERE = "is_default AND status = 'active'"

/** The customer's default active saved card, or null: what auto-renew needs to be enabled and what a renewal charges. */
export async function defaultPaymentMethod(db: Queryable, customerId: string): Promise<PaymentMethodRow | null> {
  const found = await db.query(
    `SELECT id,customer_id,provider,mode,provider_token,brand,last_four,exp_month,exp_year,status,is_default
       FROM payment_methods WHERE customer_id=$1 AND ${DEFAULT_PAYMENT_METHOD_WHERE}`, [customerId])
  return found.rows[0] ?? null
}

/** The display facts of a saved card; the provider token is left out by construction. */
export function paymentMethodView(row: PaymentMethodRow | null): PaymentMethodView | null {
  if (!row) return null
  return { id: row.id, brand: row.brand, last_four: row.last_four, exp_month: row.exp_month, exp_year: row.exp_year, status: row.status as PaymentMethodView['status'], is_default: row.is_default }
}
