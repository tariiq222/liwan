import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { bankTransferOutcome, invoiceWantsTransfer } from '../subscription'

/**
 * The customer invoice page asks the control plane where to transfer while an invoice is unpaid. Three answers must
 * stay distinguishable — instructions, "the vendor has not set an account yet" (409 `bank_account_unavailable`), and a
 * real failure. The page used to swallow every error with `catch { return null }`, which showed a customer nothing at
 * all when the request was actually broken.
 */
const root = resolve(import.meta.dirname, '../..')
const page = readFileSync(resolve(root, 'pages/subscription/invoices/[id].vue'), 'utf8')

const instructions = {
  reference: 'INV-1001', amount_minor: 9900, currency: 'SAR', exponent: 2,
  bank: { account_name: 'Example', account_number: '123', iban: 'SA4420000001234567891234', instructions_ar: 'حوّل', instructions_en: 'Transfer' },
}
const refuse = (code: string) => ({ data: { code } })

describe('bank-transfer instructions on an invoice', () => {
  it('is asked for only by a permitted reader of an issued invoice', () => {
    expect(invoiceWantsTransfer(true, { status: 'issued' })).toBe(true)
    expect(invoiceWantsTransfer(true, { status: 'paid' })).toBe(false)
    expect(invoiceWantsTransfer(false, { status: 'issued' })).toBe(false)
    expect(invoiceWantsTransfer(true, null)).toBe(false)
  })

  it('shows the instructions when the request resolves', () => {
    const outcome = bankTransferOutcome(true, { instructions })
    expect(outcome).toEqual({ kind: 'instructions', instructions })
  })

  it('reads a 409 bank_account_unavailable as "not configured", never as a failure', () => {
    expect(bankTransferOutcome(true, { cause: refuse('bank_account_unavailable') })).toEqual({ kind: 'unavailable' })
  })

  it('reports any other refusal as a failure instead of swallowing it', () => {
    for (const cause of [refuse('forbidden'), refuse('not_found'), new Error('network'), { status: 500 }])
      expect(bankTransferOutcome(true, { cause }).kind, JSON.stringify(cause)).toBe('failed')
  })

  it('asks for nothing, and so shows neither note, when the invoice is not issued', () => {
    expect(bankTransferOutcome(false, {})).toEqual({ kind: 'not_requested' })
  })

  it('treats a resolved-but-empty answer as "not configured" rather than a crash', () => {
    expect(bankTransferOutcome(true, { instructions: null })).toEqual({ kind: 'unavailable' })
  })

  it('the page routes every answer through that decision and shows each branch', () => {
    // The regression this guards: `api.bankTransfer(...).catch(() => null)` hides a real failure behind "unavailable".
    expect(page).not.toMatch(/bankTransfer\([^)]*\)\.catch/)
    expect(page).toContain('bankTransferOutcome(wantsTransfer.value, answer)')
    expect(page).toContain('outcome.kind === \'failed\'')
    expect(page).toContain('data-testid="bank-transfer-error"')
    expect(page).toContain('data-testid="bank-transfer-unavailable"')
    expect(page).toContain("t('subscription.bankTransfer.error')")
    expect(page).toContain("t('subscription.bankTransfer.unavailable')")
  })
})
