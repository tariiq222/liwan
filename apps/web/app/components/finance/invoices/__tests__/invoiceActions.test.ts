import { describe, expect, it } from 'vitest'
import { invoiceActions, invoiceHasPayments } from '../invoiceActions'

const ALL = new Set(['finance.invoices.read', 'finance.invoices.manage', 'finance.invoices.post', 'finance.payments.manage', 'finance.zatca.submit'])
const can = (capability: string) => ALL.has(capability)
const none = () => false

const base = { move_type: 'out_invoice' as const, state: 'posted' as const, payment_state: 'not_paid' as const, amount_residual: 115, debit_origin: null, zatca: null }
const zatca = (state: string) => ({ qr_code: null, confirmation_datetime: null, submission: { state, mode: 'clearance', errors: [], warnings: [], qr_present: false } }) as never

describe('invoice actions by state', () => {
  it('a draft can be edited, deleted and posted, nothing else', () => {
    const set = invoiceActions({ ...base, state: 'draft' }, can)
    expect(set).toMatchObject({ edit: true, delete: true, post: true, resetToDraft: false, cancel: true, debitNote: false, registerPayment: false, pdf: false })
  })

  it('a posted unpaid invoice offers payment, pdf, debit note, reset and cancel', () => {
    expect(invoiceActions(base, can)).toMatchObject({ edit: false, delete: false, post: false, resetToDraft: true, cancel: true, debitNote: true, registerPayment: true, pdf: true, blockedByPayments: false })
  })

  it('payments block cancel and reset and say why', () => {
    const set = invoiceActions({ ...base, payment_state: 'partial', amount_residual: 40 }, can)
    expect(set).toMatchObject({ resetToDraft: false, cancel: false, blockedByPayments: true, registerPayment: true })
    expect(invoiceHasPayments({ state: 'posted', payment_state: 'paid' })).toBe(true)
    expect(invoiceHasPayments({ state: 'draft', payment_state: 'paid' })).toBe(false)
  })

  it('a fully paid invoice cannot take another payment', () => {
    expect(invoiceActions({ ...base, payment_state: 'paid', amount_residual: 0 }, can).registerPayment).toBe(false)
  })

  it('a cancelled document can only be reset to draft', () => {
    const set = invoiceActions({ ...base, state: 'cancel' }, can)
    expect(set).toMatchObject({ resetToDraft: true, cancel: false, edit: false, pdf: false, registerPayment: false })
  })

  it('credit notes and debit notes cannot be debited again', () => {
    expect(invoiceActions({ ...base, move_type: 'out_refund' }, can).debitNote).toBe(false)
    expect(invoiceActions({ ...base, debit_origin: { id: 1, name: 'INV/1' } }, can).debitNote).toBe(false)
    expect(invoiceActions({ ...base, move_type: 'in_invoice' }, can).debitNote).toBe(true)
  })

  it('a receipt has no write actions', () => {
    const set = invoiceActions({ ...base, move_type: 'out_receipt', state: 'draft' }, can)
    expect(set).toMatchObject({ edit: false, delete: false, post: false })
  })
})

describe('invoice actions by capability', () => {
  it('a reader sees nothing but the pdf of a posted document', () => {
    const set = invoiceActions(base, (capability: string) => capability === 'finance.invoices.read')
    expect(set).toMatchObject({ edit: false, post: false, cancel: false, resetToDraft: false, debitNote: false, registerPayment: false, pdf: true })
  })

  it('no capability, no action', () => {
    expect(Object.values(invoiceActions({ ...base, state: 'draft' }, none)).every(value => value === false)).toBe(true)
  })

  it('posting is separate from managing drafts', () => {
    const manageOnly = (capability: string) => capability === 'finance.invoices.manage'
    expect(invoiceActions({ ...base, state: 'draft' }, manageOnly)).toMatchObject({ edit: true, post: false })
  })
})

describe('ZATCA actions', () => {
  it('send for a pending document, retry after a verdict-less or failed one', () => {
    expect(invoiceActions({ ...base, zatca: zatca('pending') }, can)).toMatchObject({ zatcaSubmit: true, zatcaRetry: false })
    for (const state of ['retry', 'rejected', 'blocked', 'unauthorized']) {
      expect(invoiceActions({ ...base, zatca: zatca(state) }, can)).toMatchObject({ zatcaSubmit: false, zatcaRetry: true })
    }
  })

  it('nothing for accepted, not applicable, a draft, a document without ZATCA data or a caller without the capability', () => {
    expect(invoiceActions({ ...base, zatca: zatca('accepted') }, can)).toMatchObject({ zatcaSubmit: false, zatcaRetry: false })
    expect(invoiceActions({ ...base, zatca: zatca('not_applicable') }, can)).toMatchObject({ zatcaSubmit: false, zatcaRetry: false })
    expect(invoiceActions({ ...base, state: 'draft', zatca: zatca('pending') }, can).zatcaSubmit).toBe(false)
    expect(invoiceActions(base, can).zatcaSubmit).toBe(false)
    expect(invoiceActions({ ...base, zatca: zatca('pending') }, capability => capability === 'finance.invoices.read').zatcaSubmit).toBe(false)
  })
})
