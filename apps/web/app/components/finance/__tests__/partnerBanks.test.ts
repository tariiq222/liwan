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
  it('maps the field the server named and explains a duplicate in the user language', () => {
    expect(bankFailure(new ApiError(422, 'duplicate', 'the partner already has this bank account', 'acc_number')))
      .toEqual({ field: 'accNumber', key: 'finance.partners.banks.errors.duplicate', message: 'the partner already has this bank account' })
    expect(bankFailure(new ApiError(422, 'invalid', 'acc_number is not a valid Saudi IBAN', 'acc_number')))
      .toEqual({ field: 'accNumber', key: null, message: 'acc_number is not a valid Saudi IBAN' })
    expect(bankFailure(new ApiError(422, 'invalid', 'bic needs a bank_name', 'bank_name'))?.field).toBe('bankName')
  })

  it('has nothing to say about a failure that is not an API answer', () => {
    expect(bankFailure(new Error('offline'))).toBeNull()
  })
})
