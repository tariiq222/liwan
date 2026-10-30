import type { FinanceBankImport, FinanceBankImportMapping, FinanceBankImportPreview } from '@liwan/contracts'
import { roundMoney, sameMoney } from './bankModel'

/** The server refuses larger files (2 MiB); the screen says so before reading one. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024
export const IMPORT_DELIMITERS = [',', ';', '\t', '|'] as const
export const IMPORT_DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'MM/DD/YYYY', 'YYYY/MM/DD', 'DD.MM.YYYY'] as const
export const IMPORT_MAPPING_FIELDS = ['date', 'payment_ref', 'amount', 'debit', 'credit'] as const
export type ImportMappingField = typeof IMPORT_MAPPING_FIELDS[number]

export interface BankImportDraft {
  journalId: number | null
  fileName: string
  content: string
  /** Empty lets the server detect it. */
  delimiter: string
  hasHeader: boolean
  dateFormat: typeof IMPORT_DATE_FORMATS[number]
  decimalSeparator: '.' | ','
  /** A column header, or its position when the file has no header; empty = not mapped. */
  mapping: Record<ImportMappingField, string>
  name: string
  balanceStart: string
  balanceEnd: string
  skipDuplicates: boolean
}

export function emptyImportDraft(): BankImportDraft {
  return {
    journalId: null, fileName: '', content: '', delimiter: '', hasHeader: true, dateFormat: 'YYYY-MM-DD', decimalSeparator: '.',
    mapping: { date: '', payment_ref: '', amount: '', debit: '', credit: '' }, name: '', balanceStart: '', balanceEnd: '', skipDuplicates: true,
  }
}

/** What describes how to read the file, shared by the preview and the import. */
export function importFileBody(draft: BankImportDraft) {
  return {
    journal_id: draft.journalId!,
    content: draft.content,
    ...(draft.delimiter ? { delimiter: draft.delimiter as typeof IMPORT_DELIMITERS[number] } : {}),
    has_header: draft.hasHeader,
    date_format: draft.dateFormat,
    decimal_separator: draft.decimalSeparator,
  }
}

const columnRef = (value: string, hasHeader: boolean) => hasHeader ? value : Number(value)

/** The mapping the server needs: date, reference, and either one amount column or a debit and a credit pair; otherwise null. */
export function importMapping(draft: Pick<BankImportDraft, 'mapping' | 'hasHeader'>): FinanceBankImportMapping | null {
  const { mapping, hasHeader } = draft
  const value = (field: ImportMappingField) => mapping[field] === '' ? undefined : columnRef(mapping[field], hasHeader)
  const amount = value('amount')
  const debit = value('debit')
  const credit = value('credit')
  if (value('date') === undefined || value('payment_ref') === undefined) return null
  if (amount === undefined && (debit === undefined || credit === undefined)) return null
  return {
    date: value('date')!,
    payment_ref: value('payment_ref')!,
    ...(amount !== undefined ? { amount } : { debit: debit!, credit: credit! }),
  }
}

/** Fills only the fields the user has not mapped yet from the server's suggestion. */
export function applySuggestedMapping(draft: BankImportDraft, suggested: Record<string, string>) {
  for (const field of IMPORT_MAPPING_FIELDS) if (!draft.mapping[field] && suggested[field]) draft.mapping[field] = suggested[field]
}

export function importBody(draft: BankImportDraft): FinanceBankImport | null {
  const mapping = importMapping(draft)
  const start = draft.balanceStart.trim() === '' ? Number.NaN : Number(draft.balanceStart)
  const end = draft.balanceEnd.trim() === '' ? Number.NaN : Number(draft.balanceEnd)
  if (!mapping || !draft.journalId || !draft.content || !Number.isFinite(start) || !Number.isFinite(end)) return null
  return { ...importFileBody(draft), mapping, balance_start: start, balance_end_real: end, skip_duplicates: draft.skipDuplicates, ...(draft.name.trim() ? { name: draft.name.trim() } : {}) }
}

/** The closing balance the file's new lines lead to; the bank's printed one must equal it. */
export function expectedClosing(balanceStart: string, preview: Pick<FinanceBankImportPreview, 'summary'>): number | null {
  const start = balanceStart.trim() === '' ? Number.NaN : Number(balanceStart)
  return Number.isFinite(start) ? roundMoney(start + preview.summary.total) : null
}

export function closingMatches(draft: Pick<BankImportDraft, 'balanceStart' | 'balanceEnd'>, preview: Pick<FinanceBankImportPreview, 'summary'>): boolean {
  const expected = expectedClosing(draft.balanceStart, preview)
  const end = draft.balanceEnd.trim() === '' ? Number.NaN : Number(draft.balanceEnd)
  return expected !== null && Number.isFinite(end) && sameMoney(expected, end)
}
