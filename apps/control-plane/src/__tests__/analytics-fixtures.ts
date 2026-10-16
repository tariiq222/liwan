import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

export interface Step {
  /** ISO instant the order was applied (or created, for an order that never applied). */
  at: string
  plan_revision_id: string
  base_minor: number
  cadence?: { unit: 'month' | 'year', count: number }
  paid_extra_branches?: number
  branch_unit_minor?: number
  kind?: 'new' | 'change' | 'renewal'
  fulfillment_state?: 'applied' | 'queued' | 'applying' | 'failed' | 'needs_intervention'
  currency?: string
  /** When set, the order has a paid invoice at this instant (issued the same day at 00:00). */
  paid_at?: string
}

export interface Seeded { customer_id: string, subscription_id: string, tenant_id: string | null, orders: { id: string, invoice_id: string | null }[] }

export interface Customer {
  name: string
  state: 'pending' | 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled'
  steps?: Step[]
  renewal_at?: string
  trial_ends_at?: string
  features?: Record<string, number>
  usage?: Record<string, number>
}

/** Inserts a customer with its subscription history straight into the tables (no quote flow), so a test fixes every date. */
export async function seedCustomer(pool: Pool, input: Customer): Promise<Seeded> {
  const customer_id = randomUUID(), subscription_id = randomUUID()
  const steps = input.steps ?? []
  const applied = steps.filter(step => (step.fulfillment_state ?? 'applied') === 'applied')
  const revisions = steps.map(() => randomUUID())
  const lastApplied = applied.length ? revisions[steps.indexOf(applied[applied.length - 1]!)]! : null
  let tenant_id: string | null = null
  if (input.usage) {
    tenant_id = randomUUID()
    await pool.query(`INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,$2,'saas','managed',$3,true)`, [tenant_id, input.name, `target-${tenant_id}`])
    await pool.query(`INSERT INTO usage_snapshots(tenant_id,observed_at,freshness,metrics,source) VALUES($1,now(),'fresh',$2,'fixture')`, [tenant_id, JSON.stringify(input.usage)])
  }
  await pool.query('INSERT INTO customers(id,name) VALUES($1,$2)', [customer_id, input.name])
  await pool.query(
    `INSERT INTO subscriptions(id,customer_id,tenant_id,state,renewal_at,trial_ends_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [subscription_id, customer_id, tenant_id, input.state, input.renewal_at ?? null, input.trial_ends_at ?? null, steps[0]?.at ?? new Date()])
  const orders: Seeded['orders'] = []
  for (const [index, step] of steps.entries()) {
    const state = step.fulfillment_state ?? 'applied'
    const currency = step.currency ?? 'SAR'
    const snapshot = {
      plan_revision_id: step.plan_revision_id, cadence: step.cadence ?? { unit: 'month', count: 1 },
      entitlement: { features: input.features ?? {} },
      pricing: { base_minor: step.base_minor, bundle_minor: {}, paid_extra_branches: step.paid_extra_branches ?? 0, branch_unit_minor: step.branch_unit_minor ?? 0 },
    }
    const quote = randomUUID(), order = randomUUID()
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id,created_at) VALUES($1,$2,$3,$4,$5,$6)', [revisions[index], subscription_id, index + 1, JSON.stringify(snapshot), quote, step.at])
    await pool.query(
      `INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent,created_at)
       VALUES($1,$2,$3,$4,$5,$6,'paid',$7,$8,'digest',$9,$10,2,$11)`,
      [order, customer_id, subscription_id, step.kind ?? (index === 0 ? 'new' : 'change'), quote, revisions[index], state, randomUUID(), step.base_minor, currency, step.at])
    if (state === 'applied') await pool.query(`INSERT INTO fulfillment_effects(id,order_id,operation_id,applied_at) VALUES($1,$2,$3,$4)`, [randomUUID(), order, order, step.at])
    const invoice_id = step.paid_at ? await seedInvoice(pool, { customer_id, subscription_id, order_id: order, status: 'paid', total_minor: step.base_minor, issued_at: `${step.paid_at.slice(0, 10)}T00:00:00Z`, due_at: step.paid_at, paid_at: step.paid_at, currency }) : null
    orders.push({ id: order, invoice_id })
  }
  if (lastApplied) await pool.query('UPDATE subscriptions SET applied_revision_id=$2,revision=revision+1 WHERE id=$1', [subscription_id, lastApplied])
  return { customer_id, subscription_id, tenant_id, orders }
}

export interface InvoiceInput {
  customer_id: string, subscription_id: string, order_id?: string | null, status: 'issued' | 'paid'
  total_minor: number, issued_at: string, due_at: string, paid_at?: string | null, currency?: string
  /** VAT inside `total_minor`; the subtotal is the rest. */
  tax_minor?: number
}

export async function seedInvoice(pool: Pool, input: InvoiceInput): Promise<string> {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,status,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end,issued_at,due_at,paid_at)
     VALUES($1,$2,$3,$4,'renewal',$5,$6,2,$7-$12::bigint,$12,$7,$8,$8,$9,$10,$11)`,
    [id, input.customer_id, input.subscription_id, input.order_id ?? null, input.status, input.currency ?? 'SAR', input.total_minor, input.issued_at.slice(0, 10), input.issued_at, input.due_at, input.paid_at ?? null, input.tax_minor ?? 0])
  return id
}

export async function seedAttempt(pool: Pool, input: { order_id: string, invoice_id: string, status: 'succeeded' | 'failed', at: string }): Promise<void> {
  await pool.query(
    `INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,amount_minor,currency,exponent,status,created_at,updated_at) VALUES($1,$2,$3,'simulator','simulator',100,'SAR',2,$4,$5,$5)`,
    [randomUUID(), input.order_id, input.invoice_id, input.status, input.at])
}
