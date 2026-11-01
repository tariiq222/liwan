import type { FinanceBankImport, FinanceBankImportFormat, FinanceBankImportMapping, FinanceBankImportPreview, FinanceBankImportRead } from '@liwan/contracts'
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
  /** What the server found the file to be when it read it; empty until then. */
  format: FinanceBankImportFormat | ''
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
    journalId: null, fileName: '', content: '', format: '', delimiter: '', hasHeader: true, dateFormat: 'YYYY-MM-DD', decimalSeparator: '.',
    mapping: { date: '', payment_ref: '', amount: '', debit: '', credit: '' }, name: '', balanceStart: '', balanceEnd: '', skipDuplicates: true,
  }
}

/** OFX and CAMT files carry their own layout: no delimiter, header, date format or mapping applies to them. */
export const isStatementFile = (format: BankImportDraft['format']): format is 'ofx' | 'camt' => format === 'ofx' || format === 'camt'

/** The answer to a read without a mapping is the lines of an OFX or CAMT file, or the columns of a CSV one. */
export const readFoundLines = (read: FinanceBankImportRead): read is FinanceBankImportPreview => 'lines' in read

const fileBody = (draft: BankImportDraft) => ({ journal_id: draft.journalId!, content: draft.content })

function csvFileBody(draft: BankImportDraft) {
  return {
    ...fileBody(draft),
    ...(draft.format === 'csv' ? { format: 'csv' as const } : {}),
    ...(draft.delimiter ? { delimiter: draft.delimiter as typeof IMPORT_DELIMITERS[number] } : {}),
    has_header: draft.hasHeader,
    date_format: draft.dateFormat,
    decimal_separator: draft.decimalSeparator,
  }
}

/** What describes how to read the file, shared by the read, the preview and the import. */
export function importFileBody(draft: BankImportDraft) {
  return isStatementFile(draft.format) ? { ...fileBody(draft), format: draft.format } : csvFileBody(draft)
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

/** The balances an OFX or CAMT file suggests, as the text the balance fields hold; empty where the file does not say. */
export function suggestedBalances(preview: Pick<FinanceBankImportPreview, 'balance_start' | 'balance_end_real'>) {
  return {
    balanceStart: preview.balance_start === null ? '' : String(preview.balance_start),
    balanceEnd: preview.balance_end_real === null ? '' : String(preview.balance_end_real),
  }
}

export function importBody(draft: BankImportDraft): FinanceBankImport | null {
  const start = draft.balanceStart.trim() === '' ? Number.NaN : Number(draft.balanceStart)
  const end = draft.balanceEnd.trim() === '' ? Number.NaN : Number(draft.balanceEnd)
  if (!draft.journalId || !draft.content || !Number.isFinite(start) || !Number.isFinite(end)) return null
  const options = { balance_start: start, balance_end_real: end, skip_duplicates: draft.skipDuplicates, ...(draft.name.trim() ? { name: draft.name.trim() } : {}) }
  if (isStatementFile(draft.format)) return { ...fileBody(draft), format: draft.format, ...options }
  const mapping = importMapping(draft)
  return mapping ? { ...csvFileBody(draft), mapping, ...options } : null
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
