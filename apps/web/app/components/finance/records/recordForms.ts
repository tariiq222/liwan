import type {
  FinanceAccount,
  FinanceAccountCreate,
  FinanceAccountPatch,
  FinanceAssetProfile,
  FinanceAssetProfileCreate,
  FinanceAssetProfilePatch,
  FinanceJournal,
  FinanceJournalCreate,
  FinanceJournalPatch,
  FinancePaymentTerm,
  FinancePaymentTermCreate,
  FinancePaymentTermPatch,
  FinanceTax,
  FinanceTaxCreate,
  FinanceTaxPatch,
} from '@liwan/contracts'

// The drafts the setup editors fill in and the bodies they send. An edit sends only what changed (nothing when nothing did).
const trim = (value: string) => value.trim()
const changes = <T extends object>(patch: T): T | null => Object.keys(patch).length ? patch : null

export interface AccountDraft { code: string; name: string; accountType: FinanceAccount['account_type']; reconcile: boolean; currency: string }

export function accountDraft(account?: FinanceAccount): AccountDraft {
  return { code: account?.code ?? '', name: account?.name ?? '', accountType: account?.account_type ?? 'expense', reconcile: account?.reconcile ?? false, currency: account?.currency ?? '' }
}
export const accountValid = (draft: AccountDraft) => trim(draft.code) !== '' && trim(draft.name) !== ''
export function accountCreate(draft: AccountDraft): FinanceAccountCreate {
  return {
    code: trim(draft.code), name: trim(draft.name), account_type: draft.accountType, reconcile: draft.reconcile,
    ...(trim(draft.currency) ? { currency: trim(draft.currency).toUpperCase() } : {}),
  }
}
export function accountPatch(account: FinanceAccount, draft: AccountDraft): FinanceAccountPatch | null {
  const currency = trim(draft.currency).toUpperCase() || null
  return changes<FinanceAccountPatch>({
    ...(trim(draft.code) !== account.code ? { code: trim(draft.code) } : {}),
    ...(trim(draft.name) !== account.name ? { name: trim(draft.name) } : {}),
    ...(draft.accountType !== account.account_type ? { account_type: draft.accountType } : {}),
    ...(draft.reconcile !== account.reconcile ? { reconcile: draft.reconcile } : {}),
    ...(currency !== account.currency ? { currency } : {}),
  })
}

export interface JournalDraft { name: string; code: string; type: FinanceJournal['type']; currency: string; defaultAccountId: number | null }

export const LIQUIDITY_JOURNAL_TYPES: readonly FinanceJournal['type'][] = ['bank', 'cash']
export const JOURNAL_TYPES: readonly FinanceJournal['type'][] = ['sale', 'purchase', 'bank', 'cash', 'general']

export function journalDraft(journal?: FinanceJournal): JournalDraft {
  return { name: journal?.name ?? '', code: journal?.code ?? '', type: journal?.type ?? 'sale', currency: '', defaultAccountId: journal?.default_account?.id ?? null }
}
export const journalValid = (draft: JournalDraft) =>
  trim(draft.name) !== '' && trim(draft.code) !== '' && (!LIQUIDITY_JOURNAL_TYPES.includes(draft.type) || draft.defaultAccountId !== null)
export function journalCreate(draft: JournalDraft): FinanceJournalCreate {
  return {
    name: trim(draft.name), code: trim(draft.code), type: draft.type,
    ...(trim(draft.currency) ? { currency: trim(draft.currency).toUpperCase() } : {}),
    ...(draft.defaultAccountId !== null ? { default_account_id: draft.defaultAccountId } : {}),
  }
}
export function journalPatch(journal: FinanceJournal, draft: JournalDraft): FinanceJournalPatch | null {
  return changes<FinanceJournalPatch>({
    ...(trim(draft.name) !== journal.name ? { name: trim(draft.name) } : {}),
    ...(trim(draft.code) !== journal.code ? { code: trim(draft.code) } : {}),
    ...(draft.defaultAccountId !== null && draft.defaultAccountId !== journal.default_account?.id ? { default_account_id: draft.defaultAccountId } : {}),
  })
}

export interface TaxDraft { name: string; use: FinanceTax['type_tax_use']; amountType: FinanceTax['amount_type']; amount: number | null; priceInclude: boolean; taxAccountId: number | null }

export function taxDraft(tax?: FinanceTax): TaxDraft {
  return { name: tax?.name ?? '', use: tax?.type_tax_use ?? 'sale', amountType: tax?.amount_type ?? 'percent', amount: tax?.amount ?? null, priceInclude: tax?.price_include ?? false, taxAccountId: tax?.tax_account?.id ?? null }
}
export const taxValid = (draft: TaxDraft) => trim(draft.name) !== '' && draft.amount !== null && draft.amount >= 0 && draft.taxAccountId !== null
export function taxCreate(draft: TaxDraft): FinanceTaxCreate {
  return {
    name: trim(draft.name), type_tax_use: draft.use, amount_type: draft.amountType, amount: draft.amount ?? 0,
    price_include: draft.priceInclude, tax_account_id: draft.taxAccountId ?? 0,
  }
}
/** A tax that journal items use can only be renamed: the server refuses the rest, so it is not even sent. */
export function taxPatch(tax: FinanceTax, draft: TaxDraft): FinanceTaxPatch | null {
  return changes<FinanceTaxPatch>({
    ...(trim(draft.name) !== tax.name ? { name: trim(draft.name) } : {}),
    ...(!tax.used && draft.amount !== null && draft.amount !== tax.amount ? { amount: draft.amount } : {}),
    ...(!tax.used && draft.priceInclude !== tax.price_include ? { price_include: draft.priceInclude } : {}),
    ...(!tax.used && draft.taxAccountId !== null && draft.taxAccountId !== tax.tax_account?.id ? { tax_account_id: draft.taxAccountId } : {}),
  })
}

// The three delays the API accepts; a term made elsewhere with the fourth (day of the next month) is not edited here.
export type TermDelay = 'days_after' | 'days_after_end_of_month' | 'days_after_end_of_next_month'
export type TermLineDraft = { value: 'percent' | 'fixed'; amount: number | null; days: number; delay: TermDelay }
export interface TermDraft { name: string; note: string; lines: TermLineDraft[] }

export const newTermLine = (): TermLineDraft => ({ value: 'percent', amount: null, days: 0, delay: 'days_after' })

export function termDraft(term?: FinancePaymentTerm): TermDraft {
  return {
    name: term?.name ?? '', note: '',
    lines: term ? term.lines.map(line => ({ value: line.value, amount: line.value_amount, days: line.nb_days, delay: line.delay_type === 'days_end_of_month_on_the' ? 'days_after' : line.delay_type })) : [{ ...newTermLine(), amount: 100 }],
  }
}
export const percentTotal = (draft: TermDraft) => Math.round(draft.lines.filter(line => line.value === 'percent').reduce((sum, line) => sum + (line.amount ?? 0), 0) * 100) / 100
export const termValid = (draft: TermDraft) =>
  trim(draft.name) !== '' && draft.lines.length > 0 && draft.lines.every(line => line.amount !== null && line.amount > 0 && Number.isInteger(line.days) && line.days >= 0) && percentTotal(draft) === 100
const termLines = (draft: TermDraft) => draft.lines.map(line => ({ value: line.value, value_amount: line.amount ?? 0, nb_days: line.days, delay_type: line.delay }))
export function termCreate(draft: TermDraft): FinancePaymentTermCreate {
  return { name: trim(draft.name), ...(trim(draft.note) ? { note: trim(draft.note) } : {}), lines: termLines(draft) }
}
export function termPatch(term: FinancePaymentTerm, draft: TermDraft): FinancePaymentTermPatch | null {
  const lines = termLines(draft)
  const sameLines = JSON.stringify(lines) === JSON.stringify(term.lines.map(line => ({ value: line.value, value_amount: line.value_amount, nb_days: line.nb_days, delay_type: line.delay_type })))
  return changes<FinancePaymentTermPatch>({
    ...(trim(draft.name) !== term.name ? { name: trim(draft.name) } : {}),
    ...(trim(draft.note) ? { note: trim(draft.note) } : {}),
    ...(sameLines ? {} : { lines }),
  })
}

export interface AssetProfileDraft {
  name: string
  method: 'linear' | 'degressive'
  methodTime: FinanceAssetProfile['method_time']
  methodNumber: number | null
  methodPeriod: FinanceAssetProfile['method_period']
  prorata: boolean
  assetAccountId: number | null
  depreciationAccountId: number | null
  expenseAccountId: number | null
  journalId: number | null
  plusAccountId: number | null
  minAccountId: number | null
}

export function assetProfileDraft(profile?: FinanceAssetProfile): AssetProfileDraft {
  return {
    name: profile?.name ?? '',
    method: profile?.method === 'degressive' ? 'degressive' : 'linear',
    methodTime: profile?.method_time ?? 'year',
    methodNumber: profile?.method_number ?? 5,
    methodPeriod: profile?.method_period ?? 'year',
    prorata: profile?.prorata ?? false,
    assetAccountId: profile?.asset_account.id ?? null,
    depreciationAccountId: profile?.depreciation_account.id ?? null,
    expenseAccountId: profile?.expense_account.id ?? null,
    journalId: profile?.journal.id ?? null,
    plusAccountId: profile?.plus_value_account?.id ?? null,
    minAccountId: profile?.min_value_account?.id ?? null,
  }
}
export const assetProfileValid = (draft: AssetProfileDraft) =>
  trim(draft.name) !== '' && draft.assetAccountId !== null && draft.depreciationAccountId !== null && draft.expenseAccountId !== null
  && draft.journalId !== null && draft.methodNumber !== null && Number.isInteger(draft.methodNumber) && draft.methodNumber >= 1 && draft.methodNumber <= 1200
export function assetProfileCreate(draft: AssetProfileDraft): FinanceAssetProfileCreate {
  return {
    name: trim(draft.name), asset_account_id: draft.assetAccountId!, depreciation_account_id: draft.depreciationAccountId!, expense_account_id: draft.expenseAccountId!,
    journal_id: draft.journalId!, method: draft.method, method_time: draft.methodTime, method_number: draft.methodNumber!, method_period: draft.methodPeriod, prorata: draft.prorata,
    ...(draft.plusAccountId !== null ? { plus_value_account_id: draft.plusAccountId } : {}),
    ...(draft.minAccountId !== null ? { min_value_account_id: draft.minAccountId } : {}),
  }
}
/** Only what changed is sent: once an asset uses the profile the server fixes its accounts, journal and method, and refuses a change to them. */
export function assetProfilePatch(profile: FinanceAssetProfile, draft: AssetProfileDraft): FinanceAssetProfilePatch | null {
  return changes<FinanceAssetProfilePatch>({
    ...(trim(draft.name) !== profile.name ? { name: trim(draft.name) } : {}),
    ...(draft.assetAccountId !== profile.asset_account.id ? { asset_account_id: draft.assetAccountId! } : {}),
    ...(draft.depreciationAccountId !== profile.depreciation_account.id ? { depreciation_account_id: draft.depreciationAccountId! } : {}),
    ...(draft.expenseAccountId !== profile.expense_account.id ? { expense_account_id: draft.expenseAccountId! } : {}),
    ...(draft.journalId !== profile.journal.id ? { journal_id: draft.journalId! } : {}),
    ...(draft.method !== profile.method ? { method: draft.method } : {}),
    ...(draft.methodTime !== profile.method_time ? { method_time: draft.methodTime } : {}),
    ...(draft.methodNumber !== profile.method_number ? { method_number: draft.methodNumber! } : {}),
    ...(draft.methodPeriod !== profile.method_period ? { method_period: draft.methodPeriod } : {}),
    ...(draft.prorata !== profile.prorata ? { prorata: draft.prorata } : {}),
    ...(draft.plusAccountId !== (profile.plus_value_account?.id ?? null) ? { plus_value_account_id: draft.plusAccountId } : {}),
    ...(draft.minAccountId !== (profile.min_value_account?.id ?? null) ? { min_value_account_id: draft.minAccountId } : {}),
  })
}

/** The refusals an archive can get that this app words itself; any other code shows the server's own text. */
const ARCHIVE_ERROR_KEYS: Readonly<Record<string, string>> = {
  journal_has_drafts: 'financeRecords.errors.journal_has_drafts',
}

/** The locale key of a refused archive, or null when the app has no wording for its code. */
export function archiveErrorKey(error: unknown): string | null {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : undefined
  return typeof code === 'string' && Object.hasOwn(ARCHIVE_ERROR_KEYS, code) ? ARCHIVE_ERROR_KEYS[code]! : null
}
