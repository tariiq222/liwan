import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { financeErrorKey, zatcaSubmissionFromDetails } from '../invoiceErrors'
import { INVOICE_KINDS, invoiceKindOf, invoiceRecordPath } from '../invoiceKinds'

const locale = (code: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../../../i18n/locales/${code}/finance-documents.json`), 'utf8')).financeDocuments

describe('API error codes', () => {
  it('every explained code has a message in both languages', () => {
    for (const code of ['not_draft', 'not_posted', 'has_payments', 'invalid_state', 'period_locked', 'pdf_unavailable', 'zatca_not_onboarded', 'zatca_not_applicable', 'zatca_rejected', 'zatca_unavailable', 'zatca_local_error', 'zatca_unauthorized', 'zatca_mode_not_allowed', 'amount_exceeds_residual', 'journal_currency_mismatch']) {
      const key = financeErrorKey(code)
      expect(key, code).not.toBeNull()
      const name = key!.replace('financeDocuments.errors.', '')
      expect(locale('ar').errors[name], `ar ${code}`).toBeTruthy()
      expect(locale('en').errors[name], `en ${code}`).toBeTruthy()
    }
  })

  it('leaves unknown codes to the server message', () => {
    expect(financeErrorKey('invalid')).toBeNull()
  })

  it('reads the submission a failed ZATCA call carries', () => {
    const submission = { state: 'rejected', mode: 'clearance', errors: [{ code: 'BR-1', message: 'bad' }], warnings: [], qr_present: false }
    expect(zatcaSubmissionFromDetails({ submission })?.errors[0]?.code).toBe('BR-1')
    expect(zatcaSubmissionFromDetails({ submission: { state: 'weird' } })).toBeNull()
    expect(zatcaSubmissionFromDetails(undefined)).toBeNull()
  })
})

describe('document kinds', () => {
  it('each kind has its own list path and title wording in both languages', () => {
    expect(new Set(Object.values(INVOICE_KINDS).map(kind => kind.listPath)).size).toBe(4)
    for (const moveType of Object.keys(INVOICE_KINDS)) {
      for (const code of ['ar', 'en']) expect(Object.keys(locale(code).kinds[moveType]).sort()).toEqual(['empty', 'new', 'partner', 'partnerPlaceholder', 'record', 'title'])
    }
  })

  it('opens a record under the page of its own type', () => {
    expect(invoiceRecordPath('in_refund', 9)).toBe('/finance/purchases/refunds/9')
    expect(invoiceKindOf('out_receipt')).toBeNull()
  })
})
