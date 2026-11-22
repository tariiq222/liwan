/** A cell the code wrote itself, such as a formatted figure or an amount: written exactly as given, never guarded. */
export interface CsvLiteral { readonly literal: string }
/** Text (guarded against spreadsheet formulas), a number or literal (written by code, exempt), or nothing. */
export type CsvCell = string | number | CsvLiteral | null

export const csvLiteral = (literal: string): CsvLiteral => ({ literal })

// A spreadsheet reads a text cell starting with one of these as a formula (CSV injection); the customer's name is the risk.
const FORMULA_START = /^[=+\-@\t\r]/

const quoted = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)

function cellText(cell: CsvCell): string {
  if (cell === null) return ''
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) throw new TypeError('csv_number_not_finite')
    return String(cell)
  }
  if (typeof cell === 'string') return quoted(FORMULA_START.test(cell) ? `'${cell}` : cell)
  return quoted(cell.literal)
}

/**
 * Comma CSV for spreadsheets: a UTF-8 byte-order mark so Arabic text opens correctly, CRLF line ends, quotes doubled.
 * The header is written by the code and is not guarded; a text cell that could start a formula gets a leading apostrophe.
 */
export function toCsvTable(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header.map(quoted), ...rows.map(row => row.map(cellText))]
  return `﻿${lines.map(line => line.join(',')).join('\r\n')}\r\n`
}

/** Hands the browser the CSV text as a file to save. */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  Object.assign(document.createElement('a'), { href: url, download: fileName }).click()
  URL.revokeObjectURL(url)
}
