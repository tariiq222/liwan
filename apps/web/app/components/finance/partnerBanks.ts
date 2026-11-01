import type { FinancePartnerBank, FinancePartnerBankCreate, FinancePartnerBankPatch } from '@liwan/contracts'
import { ApiError } from '../../composables/useApi'

/** The editor of a partner's bank account as typed. The server sanitizes the account number (case, spaces, dashes) and validates a Saudi IBAN. */
export interface PartnerBankDraft {
  accNumber: string
  holderName: string
  bankName: string
  bic: string
}

export type PartnerBankField = 'accNumber' | 'bankName'
export type PartnerBankErrors = Partial<Record<PartnerBankField, 'required' | 'bankNameForBic'>>

/** The account number fields the server names in a refusal, as the editor knows them. */
const SERVER_FIELDS: Record<string, keyof PartnerBankDraft> = {
  acc_number: 'accNumber',
  holder_name: 'holderName',
  bank_name: 'bankName',
  bic: 'bic',
}

export function emptyBankDraft(): PartnerBankDraft {
  return { accNumber: '', holderName: '', bankName: '', bic: '' }
}

export function bankDraftFromRecord(account: FinancePartnerBank): PartnerBankDraft {
  return { accNumber: account.acc_number, holderName: account.holder_name, bankName: account.bank_name, bic: account.bic }
}

export function validateBankDraft(draft: PartnerBankDraft): PartnerBankErrors {
  return {
    ...(draft.accNumber.trim() ? {} : { accNumber: 'required' as const }),
    // A BIC identifies a bank, so the server needs the bank's name with it.
    ...(draft.bic.trim() && !draft.bankName.trim() ? { bankName: 'bankNameForBic' as const } : {}),
  }
}

export function buildBankCreate(draft: PartnerBankDraft): FinancePartnerBankCreate {
  return {
    acc_number: draft.accNumber.trim(),
    ...(draft.holderName.trim() ? { holder_name: draft.holderName.trim() } : {}),
    ...(draft.bankName.trim() ? { bank_name: draft.bankName.trim() } : {}),
    ...(draft.bic.trim() ? { bic: draft.bic.trim() } : {}),
  }
}

/** The changed fields only, or null when nothing changed. A field emptied sends an empty text, which clears it. */
export function buildBankPatch(draft: PartnerBankDraft, initial: PartnerBankDraft): FinancePartnerBankPatch | null {
  const patch: FinancePartnerBankPatch = {}
  if (draft.accNumber.trim() !== initial.accNumber) patch.acc_number = draft.accNumber.trim()
  if (draft.holderName.trim() !== initial.holderName) patch.holder_name = draft.holderName.trim()
  if (draft.bankName.trim() !== initial.bankName) patch.bank_name = draft.bankName.trim()
  if (draft.bic.trim() !== initial.bic) patch.bic = draft.bic.trim()
  return Object.keys(patch).length ? patch : null
}

export interface PartnerBankFailure {
  /** The editor field the server named, if any. */
  field: keyof PartnerBankDraft | null
  /** The i18n key of the message to show: never the server's English text. */
  key: string
}

const ERRORS = 'finance.partners.banks.errors'

/** The user's-language message of a refused bank-account write, chosen by the server's code and field. */
function failureKey(cause: ApiError, field: keyof PartnerBankDraft | null): string {
  if (cause.status === 0) return 'errors.saveUncertain'
  if (cause.code === 'duplicate') return `${ERRORS}.duplicate`
  if (cause.code === 'invalid' && field === 'accNumber') return `${ERRORS}.accNumberInvalid`
  if (cause.code === 'invalid' && field === 'bankName') return `${ERRORS}.bankNameForBic`
  if (cause.code === 'invalid' && field) return `${ERRORS}.fieldInvalid`
  return 'errors.generic'
}

/** What a failed bank-account call means for the editor: the field it names and the message key, whatever the cause. */
export function bankFailure(cause: unknown): PartnerBankFailure {
  if (!(cause instanceof ApiError)) return { field: null, key: 'errors.generic' }
  const field = cause.field ? SERVER_FIELDS[cause.field] ?? null : null
  return { field, key: failureKey(cause, field) }
}
