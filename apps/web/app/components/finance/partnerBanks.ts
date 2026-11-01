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
  /** An i18n key for a code the screen explains, else null and the server's own text. */
  key: string | null
  message: string
}

/** What a refused bank-account write means for the editor: the field it names, the user's-language key for a known code, else the server's text. */
export function bankFailure(cause: unknown): PartnerBankFailure | null {
  if (!(cause instanceof ApiError)) return null
  return {
    field: cause.field ? SERVER_FIELDS[cause.field] ?? null : null,
    key: cause.code === 'duplicate' ? 'finance.partners.banks.errors.duplicate' : null,
    message: cause.message,
  }
}
