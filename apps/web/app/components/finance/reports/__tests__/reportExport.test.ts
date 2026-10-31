import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import ar from '../../../../../i18n/locales/ar/finance-reports.json'
import { REPORTS, type LoadedReport, type ReportSlug } from '../reportConfig'
import { reportCsv, reportTable } from '../reportExport'

const fixtures = resolve(import.meta.dirname, '../../../../../../../packages/contracts/fixtures/finance')
const FILES: Partial<Record<ReportSlug, string>> = {
  'trial-balance': 'report-trial-balance', 'general-ledger': 'report-general-ledger', 'aged-partner-balance': 'report-aged-partner-balance',
  'partner-statement': 'report-partner-statement', 'vat': 'report-vat', 'withholding': 'report-withholding', 'analytic': 'analytic-report',
  'profit-loss': 'report-profit-loss', 'balance-sheet': 'report-balance-sheet', 'zakat-base': 'report-zakat-base', 'budget-vs-actual': 'budget-vs-actual',
  'cash-flow': 'report-cash-flow', 'vat-return': 'report-vat-return',
}

function lookup(path: string): string | undefined {
  const found = path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), ar)
  return typeof found === 'string' ? found : undefined
}
const t = (key: string) => lookup(key) ?? key
const has = (key: string) => lookup(key) !== undefined

function load(slug: ReportSlug): LoadedReport {
  const raw = JSON.parse(readFileSync(resolve(fixtures, `${FILES[slug]}.json`), 'utf8'))
  return REPORTS[slug].schema.parse(raw) as LoadedReport
}

describe('report export', () => {
  it('has a fixture for every report', () => {
    expect(Object.keys(FILES).sort()).toEqual(Object.keys(REPORTS).sort())
  })

  it.each(Object.keys(FILES) as ReportSlug[])('flattens %s into a rectangle with named columns', (slug) => {
    const table = reportTable(load(slug), 'Title', t, has)
    expect(table.columns.length).toBeGreaterThan(1)
    expect(table.columns.every(column => column && !column.startsWith('financeReports.'))).toBe(true)
    expect(table.rows.length).toBeGreaterThan(0)
    for (const row of table.rows) expect(row).toHaveLength(table.columns.length)
  })
})

describe('report csv', () => {
  const table = { title: 'T', columns: ['Name', 'Amount'], rows: [['Plain', 1.5], ['Has, comma "and quote"', -2], ['=SUM(A1)', null], ['line\nbreak', 0]] as (string | number | null)[][] }

  it('starts with a byte order mark and ends every row with CRLF', () => {
    const csv = reportCsv(table)
    expect(csv.startsWith('﻿Name,Amount\r\n')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('quotes what needs quoting and keeps numbers as numbers', () => {
    const lines = reportCsv(table).split('\r\n')
    expect(lines[1]).toBe('Plain,1.5')
    expect(lines[2]).toBe('"Has, comma ""and quote""",-2')
  })

  it('keeps a text that looks like a formula as text', () => {
    expect(reportCsv(table)).toContain("'=SUM(A1),\r\n")
  })
})
