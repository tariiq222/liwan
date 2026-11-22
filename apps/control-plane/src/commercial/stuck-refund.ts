import type { Pool, PoolClient } from 'pg'
import { refundConflictSchema, stuckRefundSchema, type RecordReturnedRefundRequest, type RefundRecheck, type StuckRefund, type StuckRefundAction } from '@liwan/commercial-contracts'
import { transaction } from '../db.js'
import { actorLabel } from '../admin-auth/grants.js'
import { audit, CommercialHttpError, type CommercialActor } from './lifecycle.js'
import { getVendorInvoice, type VendorInvoiceView } from './invoices.js'
import { completeOutbox, releaseOutbox } from './outbox.js'
import type { PaymentAdapter, ProviderEvent } from './payment-adapter.js'
import { findRefundAttempt, noteProviderRefund, readVerifiedPayment, recordRefundIn, refundReferenceConflict, settleUndeliveredOrder, systemRefunds, withRefundLock, type RefundOutboxPayload, type SystemRefund } from './settlements.js'

type Q = Pick<Pool, 'query'>

/** A pending automatic refund whose row holds a mark: the only rows the operator may check, release or record. */
export const isStuckRefund = (refund: SystemRefund) => refund.status === 'pending' && (refund.provider_refund === 'attempted' || refund.provider_refund === 'returned')

/** The causes of the notes an undelivered order's own refund row serves (no `adjustment_id`): the fulfilment-failure and the payment-after-cancellation note. */
const ORDER_LEVEL_CAUSES = ['fulfillment_failure', 'payment_after_cancellation']
/** Whether the row's refund is the one this note records: the note the row names (a vendor-requested refund), or an undelivered order's own note. */
const recordsNote = (note: { id: string; cause: string }, rowAdjustmentId: string | null) => rowAdjustmentId === note.id || (rowAdjustmentId === null && ORDER_LEVEL_CAUSES.includes(note.cause))

/** The actions the operator is offered for a stuck row of one note. */
function allowedActions(note: { id: string; cause: string }, refund: SystemRefund): StuckRefundAction[] {
  if (refund.provider_refund === 'attempted') return ['check', 'release']
  return recordsNote(note, refund.adjustment_id) ? ['check', 'record'] : ['check']
}

/** The note that already holds the payment id as its refund reference, or null. */
async function conflictOf(db: Q, noteId: string, invoiceId: string, paymentId: string | null) {
  if (!paymentId) return null
  const row = (await db.query(`SELECT n.id,n.invoice_id,i.number,n.amount_minor,n.currency,n.exponent,n.cause,n.status,n.refunded_by,n.refunded_at
    FROM invoice_adjustments n JOIN invoices i ON i.id=n.invoice_id WHERE n.refund_reference=$1 AND n.id<>$2`, [paymentId, noteId])).rows[0]
  return row ? refundConflictSchema.parse({ adjustment_id: row.id, invoice_id: row.invoice_id, invoice_number: row.number ?? null,
    amount: { currency: row.currency, exponent: Number(row.exponent), minor: Number(row.amount_minor) }, cause: row.cause, status: row.status,
    refunded_by: row.refunded_by ?? null, refunded_at: row.refunded_at ? new Date(row.refunded_at).toISOString() : null, same_invoice: row.invoice_id === invoiceId }) : null
}

export type StuckRefundResult = { invoice: VendorInvoiceView; provider: RefundRecheck | null }
type Mark = 'attempted' | 'returned'
type StuckContext = { note: Record<string, any>; row: { id: string; aggregate_id: string; created_at: Date; payload: RefundOutboxPayload }; mark: Mark; attempt: Record<string, any> }
/**
 * One action on a stuck row. `read` runs under the refund lock before anything is written (the provider's figures and every refusal that
 * needs them); `write` runs in one transaction that re-locks the row and re-checks its mark. `provider` is what `read` found, shown to the operator.
 */
type StuckStep = { marks: Mark[]; read: (ctx: StuckContext) => Promise<RefundRecheck | null>; write: (client: PoolClient, ctx: StuckContext, provider: RefundRecheck | null) => Promise<void> }

const refused = (code: string) => new CommercialHttpError(code, 409)

/** The paying attempt of the row; an order that moved on is `refund_attempt_unavailable`, a payment that is not the invoice's is `unmatched`. */
async function attemptOf(db: Q, row: StuckContext['row'], unmatched: string): Promise<Record<string, any>> {
  try { return await findRefundAttempt(db, row) }
  catch (error) { throw refused(error instanceof Error && error.message === 'refund_attempt_unavailable' ? 'refund_attempt_unavailable' : unmatched) }
}

/**
 * The provider's own answer for the attempt's payment, by the worker's own checks (provider, mode, payment id, amount, currency, merchant
 * account). A failed read or a payment that is not the attempt's is `provider_status_unverified`; no adapter for the attempt's provider is
 * `provider_refund_unavailable`.
 */
async function readProviderPayment(adapter: PaymentAdapter | undefined, attempt: Record<string, any>, payload: RefundOutboxPayload) {
  if (!adapter) throw refused('provider_refund_unavailable')
  try { return (await readVerifiedPayment(adapter, attempt, payload)).payment }
  catch (error) { throw refused(error instanceof Error && error.message === 'provider_refund_unavailable' ? 'provider_refund_unavailable' : 'provider_status_unverified') }
}
const recheckOf = (payment: ProviderEvent & { payment_id: string }): RefundRecheck => ({ status: payment.status, payment_id: payment.payment_id, refunded: payment.refunded ?? null })

/**
 * Runs one operator action on the stuck refund of a note. It takes the worker's own refund lock (a held lock is 409 `refund_in_progress`),
 * re-reads the row and does nothing for a row that finished meanwhile (the current view comes back). A row without the mark the action
 * serves is 409 `refund_not_stuck`. The action never calls the provider's refund endpoint: money leaves only through the worker.
 */
async function runStuckAction(pool: Pool, adjustmentId: string, unmatched: string, step: StuckStep): Promise<StuckRefundResult> {
  const note = (await pool.query('SELECT * FROM invoice_adjustments WHERE id=$1', [adjustmentId])).rows[0]
  if (!note) throw new CommercialHttpError('not_found', 404)
  const view = async (provider: RefundRecheck | null): Promise<StuckRefundResult> => ({ invoice: (await getVendorInvoice(pool, note.invoice_id))!, provider })
  const refund = (await systemRefunds(pool, [note.id])).get(note.id)
  if (!refund) throw refused('refund_not_stuck')
  if (refund.status !== 'pending') return view(null)
  const locked = await withRefundLock(pool, refund.order_id, async () => {
    const row = (await pool.query('SELECT * FROM commercial_outbox WHERE id=$1', [refund.outbox_id])).rows[0]
    if (row.status !== 'pending') return null
    const mark = row.payload.provider_refund as Mark | undefined
    if (!mark || !step.marks.includes(mark)) throw refused('refund_not_stuck')
    const ctx: StuckContext = { note, row, mark, attempt: await attemptOf(pool, row, unmatched) }
    const provider = await step.read(ctx)
    await transaction(pool, async client => {
      const current = (await client.query("SELECT status,payload->>'provider_refund' AS mark FROM commercial_outbox WHERE id=$1 FOR UPDATE", [row.id])).rows[0]
      if (current.status !== 'pending' || current.mark !== mark) throw refused('refund_not_stuck')
      await step.write(client, ctx, provider)
    })
    return provider
  })
  if (!locked.owned) throw refused('refund_in_progress')
  return view(locked.value)
}

/**
 * Check again now: reads the payment at the provider, shows its status, refunded figure and payment id, and makes the row due so the worker
 * runs its own next step. Nothing else on the row changes.
 */
export function recheckAutomaticRefund(pool: Pool, { adjustment_id, actor, adapter }: { adjustment_id: string; actor: CommercialActor; adapter?: PaymentAdapter }): Promise<StuckRefundResult> {
  return runStuckAction(pool, adjustment_id, 'provider_status_unverified', {
    marks: ['attempted', 'returned'],
    read: async ({ attempt, row }) => recheckOf(await readProviderPayment(adapter, attempt, row.payload)),
    write: async (client, { note, row, mark }, provider) => {
      await releaseOutbox(client, row.id)
      await audit(client, actor, 'payment.refund_rechecked', note.id, 'Checked the payment at the provider',
        { outbox_id: row.id, order_id: row.aggregate_id, provider_refund: mark, payment_id: provider!.payment_id, provider_status: provider!.status, refunded_minor: provider!.refunded?.minor ?? null })
    },
  })
}

/** How long an `attempted` mark must stand before it may be released: a refund call made before it may still land at the provider. */
export const RELEASE_MIN_AGE_MINUTES = 60

/**
 * What the provider's answer proves about an `attempted` mark: `returned` (the whole payment is refunded) or `not_returned` (the payment is paid and
 * nothing is refunded). Anything else is not definitive and refuses the release: a status `refunded` with no figure, a figure above the payment or in
 * another currency, or a partial figure (the worker keeps asking for the rest, so the mark stays).
 */
function holdOutcome(provider: RefundRecheck, attempt: Record<string, any>): 'returned' | 'not_returned' {
  const figure = provider.refunded
  if (!figure) {
    if (provider.status === 'succeeded') return 'not_returned'
    throw refused('provider_refund_amount_unverified')
  }
  const total = Number(attempt.amount_minor)
  if (figure.currency !== attempt.currency || figure.exponent !== attempt.exponent || figure.minor <= 0 || figure.minor > total) throw refused('provider_refund_amount_unverified')
  if (figure.minor < total) throw refused('provider_refund_partial')
  return 'returned'
}

/**
 * Release the hold: lifts the `attempted` mark only when the provider's answer is definitive (see `holdOutcome`) and the mark is at least
 * RELEASE_MIN_AGE_MINUTES old (the mark's own `attempted_at`, or the row's creation for a row marked before it existed). A refunded payment is marked
 * `returned`, as the worker would mark it; a payment with nothing refunded loses the mark. Either way the row is made due and the worker takes the
 * next step by its own guarded path. There is no override: any other answer is refused.
 */
export function releaseRefundHold(pool: Pool, { adjustment_id, actor, adapter, reason, now = Date.now() }: { adjustment_id: string; actor: CommercialActor; adapter?: PaymentAdapter; reason: string; now?: number }): Promise<StuckRefundResult> {
  return runStuckAction(pool, adjustment_id, 'provider_status_unverified', {
    marks: ['attempted'],
    read: async ({ attempt, row }) => {
      if (!adapter) throw refused('provider_refund_unavailable')
      const markedAt = Date.parse(row.payload.attempted_at ?? row.created_at.toISOString())
      if (now - markedAt < RELEASE_MIN_AGE_MINUTES * 60_000) throw refused('refund_attempt_too_recent')
      const provider = recheckOf(await readProviderPayment(adapter, attempt, row.payload))
      holdOutcome(provider, attempt)
      return provider
    },
    write: async (client, { note, row, attempt }, provider) => {
      const outcome = holdOutcome(provider!, attempt)
      await noteProviderRefund(client, row.id, outcome === 'returned' ? { provider_refund: 'returned', provider_payment_id: provider!.payment_id! } : null)
      await releaseOutbox(client, row.id)
      await audit(client, actor, 'payment.refund_hold_released', note.id, reason,
        { outbox_id: row.id, order_id: row.aggregate_id, outcome, payment_id: provider!.payment_id, provider_status: provider!.status, refunded_minor: provider!.refunded?.minor ?? null,
          attempted_at: row.payload.attempted_at ?? null })
    },
  })
}

/**
 * Record the returned refund: the provider returned the money (the `returned` mark came from a verified read) and the worker cannot record it,
 * usually because another note holds the payment id. `record` is the worker's own recording with the operator as actor, under the payment id or,
 * when another note holds it, `<payment id>#<short note id>`; the row is completed. `already_recorded` closes the stuck note as void when a note of the
 * same invoice that covers at least as much already credits this money, and completes the row. It never needs the provider and never moves money.
 */
export function recordReturnedRefund(pool: Pool, { adjustment_id, actor, reason, resolution }: { adjustment_id: string; actor: CommercialActor } & RecordReturnedRefundRequest): Promise<StuckRefundResult> {
  return runStuckAction(pool, adjustment_id, 'refund_attempt_unavailable', {
    marks: ['returned'],
    read: async ({ note, row }) => {
      if (!row.payload.provider_payment_id || !recordsNote(note as { id: string; cause: string }, row.payload.adjustment_id ?? null)) throw refused('refund_not_stuck')
      return null
    },
    write: async (client, { note: seen, row, attempt }) => {
      const note = (await client.query('SELECT * FROM invoice_adjustments WHERE id=$1 FOR UPDATE', [seen.id])).rows[0]
      if (note.kind !== 'credit_note' || note.status !== 'pending') throw refused('credit_note_not_pending')
      if (note.invoice_id !== attempt.invoice_id) throw refused('refund_note_unavailable')
      const paymentId = row.payload.provider_payment_id!
      const holder = (await client.query('SELECT * FROM invoice_adjustments WHERE refund_reference=$1 AND id<>$2', [paymentId, note.id])).rows[0]
      if (resolution === 'already_recorded') return closeAsDuplicate(client, { actor, reason, note, row, holder, paymentId })
      const credited = Number((await client.query(`SELECT COALESCE(sum(amount_minor),0) AS amount FROM invoice_adjustments
        WHERE invoice_id=$1 AND kind='credit_note' AND status='refunded' AND cause<>'duplicate_payment' AND id<>$2`, [note.invoice_id, note.id])).rows[0].amount)
      if (credited + Number(note.amount_minor) > Number(attempt.amount_minor)) throw refused('refund_over_credit')
      await recordRefundIn(client, { adjustment_id: note.id, actor, refundedBy: actorLabel(actor), automatic: true, resolvedStuck: { conflicting_adjustment_id: holder?.id ?? null },
        request: { external_reference: holder ? `${paymentId}#${note.id.slice(0, 8)}` : paymentId, reason } })
      await completeOutbox(client, row.id)
    },
  }).catch(error => { throw refundReferenceConflict(error) ? refused('refund_reference_in_use') : error })
}

/** `already_recorded`: the stuck note is void and its row done, when the note holding the payment id is on the same invoice and covers this note. */
async function closeAsDuplicate(client: PoolClient, { actor, reason, note, row, holder, paymentId }: {
  actor: CommercialActor; reason: string; note: Record<string, any>; row: StuckContext['row']; holder: Record<string, any> | undefined; paymentId: string
}) {
  if (!holder || holder.invoice_id !== note.invoice_id || holder.kind !== 'credit_note' || holder.status !== 'refunded' || Number(holder.amount_minor) < Number(note.amount_minor)) throw refused('refund_not_duplicate')
  await client.query("UPDATE invoice_adjustments SET status='void' WHERE id=$1", [note.id])
  if (ORDER_LEVEL_CAUSES.includes(note.cause)) await settleUndeliveredOrder(client, note.invoice_id)
  await completeOutbox(client, row.id)
  await audit(client, actor, 'payment.refund_duplicate_closed', note.id, reason,
    { invoice_id: note.invoice_id, outbox_id: row.id, order_id: row.aggregate_id, conflicting_adjustment_id: holder.id, payment_id: paymentId, amount_minor: Number(note.amount_minor), currency: note.currency })
}

/** The stuck detail of each note whose refund row is stuck (keyed by note id); every other note has none. Only stuck rows pay for a read. */
export async function stuckRefundViews(db: Q, notes: { id: string; invoice_id: string; cause: string }[], refunds: Map<string, SystemRefund>): Promise<Map<string, StuckRefund>> {
  const out = new Map<string, StuckRefund>()
  for (const note of notes) {
    const refund = refunds.get(note.id)
    if (!refund || !isStuckRefund(refund)) continue
    out.set(note.id, stuckRefundSchema.parse({ since: refund.created_at.toISOString(), attempts: refund.attempts, next_attempt_at: refund.next_attempt_at.toISOString(),
      provider_payment_id: refund.provider_payment_id, conflict: refund.provider_refund === 'returned' ? await conflictOf(db, note.id, note.invoice_id, refund.provider_payment_id) : null,
      actions: allowedActions(note, refund) }))
  }
  return out
}
