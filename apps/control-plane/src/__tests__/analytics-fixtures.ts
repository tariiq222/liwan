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
  paid_users?: number
  user_unit_minor?: number
  paid_storage_gb?: number
  storage_unit_minor?: number
  /** Recurring price per bundle revision in the snapshot's pricing. */
  bundle_minor?: Record<string, number>
  kind?: 'new' | 'change' | 'renewal'
  fulfillment_state?: 'applied' | 'queued' | 'applying' | 'failed' | 'needs_intervention'
  currency?: string
  /** When set, the order has a paid invoice at this instant (issued the same day at 00:00). */
  paid_at?: string
  payment_state?: 'paid' | 'not_required'
}

export interface Seeded { customer_id: string, subscription_id: string, tenant_id: string | null, orders: { id: string, invoice_id: string | null }[] }

export interface Customer {
  name: string
  state: 'pending' | 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled'
  steps?: Step[]
  renewal_at?: string
  trial_ends_at?: string
  features?: Record<string, number | boolean>
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
    await pool.query(`INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,$2,'saas','dedicated_managed',$3,true)`, [tenant_id, input.name, `target-${tenant_id}`])
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
      pricing: { base_minor: step.base_minor, bundle_minor: step.bundle_minor ?? {}, paid_extra_branches: step.paid_extra_branches ?? 0, branch_unit_minor: step.branch_unit_minor ?? 0, paid_users: step.paid_users ?? 0, user_unit_minor: step.user_unit_minor ?? 0, paid_storage_gb: step.paid_storage_gb ?? 0, storage_unit_minor: step.storage_unit_minor ?? 0 },
    }
    const quote = randomUUID(), order = randomUUID()
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id,created_at) VALUES($1,$2,$3,$4,$5,$6)', [revisions[index], subscription_id, index + 1, JSON.stringify(snapshot), quote, step.at])
    await pool.query(
      `INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'digest',$10,$11,2,$12)`,
      [order, customer_id, subscription_id, step.kind ?? (index === 0 ? 'new' : 'change'), quote, revisions[index], step.payment_state ?? 'paid', state, randomUUID(), step.base_minor, currency, step.at])
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
    `INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,amount_minor,currency,exponent,status,created_at,updated_at,kind) VALUES($1,$2,$3,'simulator','simulator',100,'SAR',2,$4,$5,$5,'hosted_invoice')`,
    [randomUUID(), input.order_id, input.invoice_id, input.status, input.at])
}

export interface SignupInput {
  name: string
  plan_revision_id: string
  /** Apps selected at enrollment, as the first revision's entitlement features. */
  apps: { crm?: boolean, inbox?: boolean }
  /** When the public signup was enrolled (the first, unpaid `new` order). */
  registered_at: string
  /** When the first sign-in started the trial; omitted for a signup that never signed in. */
  trial_ends_at?: string
  /** Paid first invoice after the trial. */
  first_paid_at?: string
  /** First renewal: invoice due date, and when it was paid (omitted while unpaid). */
  renewal?: { due_at: string, paid_at?: string }
  /** False for a trial started by a vendor or invitation instead of a public signup waiting for first sign-in. */
  requires_first_login?: boolean
}

/** A public self-service signup with its trial audit, first payment and first renewal, so a test fixes every funnel milestone. */
export async function seedSignup(pool: Pool, input: SignupInput): Promise<Seeded> {
  const seeded = await seedCustomer(pool, { name: input.name, state: 'trialing', features: { 'crm.enabled': input.apps.crm ?? false, 'inbox.enabled': input.apps.inbox ?? false }, steps: [
    { at: input.registered_at, plan_revision_id: input.plan_revision_id, base_minor: 0, payment_state: 'not_required' }] })
  await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile,requires_first_login) VALUES($1,$2,$3,$4)',
    [seeded.customer_id, `${seeded.customer_id}@example.com`, seeded.customer_id.slice(0, 13), input.requires_first_login ?? true])
  if (input.trial_ends_at) {
    await pool.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata,created_at) VALUES($1,'fixture','trial.started',$2,'Fixture',$3,$4)`,
      [randomUUID(), seeded.customer_id, JSON.stringify({ trial_ends_at: input.trial_ends_at }), input.registered_at])
  }
  if (input.first_paid_at) {
    await seedInvoice(pool, { customer_id: seeded.customer_id, subscription_id: seeded.subscription_id, status: 'paid', total_minor: 11500,
      issued_at: input.first_paid_at, due_at: input.first_paid_at, paid_at: input.first_paid_at })
  }
  if (input.renewal) {
    const { customer_id, subscription_id } = seeded
    const order = randomUUID(), quote = randomUUID(), revision = randomUUID()
    const snapshot = { plan_revision_id: input.plan_revision_id, cadence: { unit: 'month', count: 1 }, entitlement: { features: {} }, pricing: { base_minor: 10000, bundle_minor: {}, paid_extra_branches: 0, branch_unit_minor: 0, paid_users: 0, user_unit_minor: 0, paid_storage_gb: 0, storage_unit_minor: 0 } }
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id,created_at) VALUES($1,$2,2,$3,$4,$5)', [revision, subscription_id, JSON.stringify(snapshot), quote, input.renewal.due_at])
    await pool.query(
      `INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent,created_at)
       VALUES($1,$2,$3,'renewal',$4,$5,'paid','applied',$6,'digest',10000,'SAR',2,$7)`, [order, customer_id, subscription_id, quote, revision, randomUUID(), input.renewal.due_at])
    const invoice = await seedInvoice(pool, { customer_id, subscription_id, order_id: order, status: input.renewal.paid_at ? 'paid' : 'issued', total_minor: 10000,
      issued_at: input.renewal.due_at, due_at: input.renewal.due_at, paid_at: input.renewal.paid_at ?? null })
    await pool.query(`INSERT INTO renewals(id,subscription_id,period_start,period_end,kind,invoice_id,order_id,status) VALUES($1,$2,$3,$3,'renewal',$4,$5,'invoiced')`,
      [randomUUID(), subscription_id, input.renewal.due_at.slice(0, 10), invoice, order])
  }
  return seeded
}
