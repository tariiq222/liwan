import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FinancePartnerBankCreateSchema } from '@liwan/contracts'
import { ApiError } from '../../../composables/useApi'
import {
  bankDraftFromRecord,
  bankFailure,
  buildBankCreate,
  buildBankPatch,
  emptyBankDraft,
  validateBankDraft,
} from '../partnerBanks'

const record = { id: 5, acc_number: 'SA0380000000608010167519', holder_name: 'Acme', bank_name: 'Al Rajhi', bic: 'RJHISARI', active: true }

describe('the bank account draft', () => {
  it('needs an account number, and a bank name when a BIC is given', () => {
    expect(validateBankDraft(emptyBankDraft())).toEqual({ accNumber: 'required' })
    expect(validateBankDraft({ ...emptyBankDraft(), accNumber: 'SA03', bic: 'RJHISARI' })).toEqual({ bankName: 'bankNameForBic' })
    expect(validateBankDraft(bankDraftFromRecord(record))).toEqual({})
  })

  it('creates with the typed fields only', () => {
    const body = buildBankCreate({ accNumber: ' SA03 8000 ', holderName: '', bankName: 'Al Rajhi', bic: '' })
    expect(body).toEqual({ acc_number: 'SA03 8000', bank_name: 'Al Rajhi' })
    expect(FinancePartnerBankCreateSchema.parse(body)).toEqual(body)
  })

  it('patches the changed fields only, and nothing when nothing changed', () => {
    const initial = bankDraftFromRecord(record)
    expect(buildBankPatch({ ...initial }, initial)).toBeNull()
    expect(buildBankPatch({ ...initial, holderName: 'Acme Co', bic: '' }, initial)).toEqual({ holder_name: 'Acme Co', bic: '' })
  })
})

describe('what a refused write means for the editor', () => {
  const refusal = (status: number, code: string, field?: string) => bankFailure(new ApiError(status, code, 'English server text', field))

  it('chooses the user-language message by the server code and field', () => {
    expect(refusal(422, 'duplicate', 'acc_number')).toEqual({ field: 'accNumber', key: 'finance.partners.banks.errors.duplicate' })
    expect(refusal(422, 'invalid', 'acc_number')).toEqual({ field: 'accNumber', key: 'finance.partners.banks.errors.accNumberInvalid' })
    expect(refusal(422, 'invalid', 'bank_name')).toEqual({ field: 'bankName', key: 'finance.partners.banks.errors.bankNameForBic' })
    expect(refusal(422, 'invalid', 'holder_name')).toEqual({ field: 'holderName', key: 'finance.partners.banks.errors.fieldInvalid' })
  })

  it('never lets the server text through: other answers are generic, a lost answer is uncertain', () => {
    expect(refusal(404, 'not_found')).toEqual({ field: null, key: 'errors.generic' })
    expect(refusal(403, 'forbidden')).toEqual({ field: null, key: 'errors.generic' })
    expect(refusal(0, 'network')).toEqual({ field: null, key: 'errors.saveUncertain' })
    expect(bankFailure(new Error('offline'))).toEqual({ field: null, key: 'errors.generic' })
  })

  it('has an Arabic and an English message for every key it can return', () => {
    for (const locale of ['ar', 'en']) {
      const banks = JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../../i18n/locales/${locale}/finance.json`), 'utf8')).finance.partners.banks.errors
      for (const key of ['duplicate', 'accNumberInvalid', 'bankNameForBic', 'fieldInvalid', 'accNumberRequired']) expect(banks[key], `${locale}.${key}`).toBeTruthy()
    }
  })
})
