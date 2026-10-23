import { afterEach, describe, expect, it, vi } from 'vitest'
import { isHeavyRoute } from '../heavyRoutes'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

const READS = [
  ...['aged-partner-balance', 'analytic', 'analytic/lines', 'balance-sheet', 'budget-vs-actual', 'cash-flow', 'general-ledger', 'partner-statement', 'profit-loss', 'trial-balance', 'vat', 'vat-return', 'vat-return/items', 'withholding', 'zakat-base']
    .map(name => `/api/v1/finance/reports/${name}`),
  ...['bank-file', 'wps-file', 'gosi-statement'].map(name => `/api/v1/hr/payroll/runs/12/${name}`),
  '/api/v1/reports/projects/summary',
  '/api/v1/reports/projects/analytics',
  '/api/v1/meetings/7/minutes.pdf',
  '/api/v1/finance/invoices/7/pdf',
]
const WRITES = [
  '/api/v1/finance/assets/compute-depreciation',
  ...['entries', 'invoices', 'payments'].map(kind => `/api/v1/finance/${kind}/3/post`),
  ...['compute', 'post'].map(action => `/api/v1/hr/payroll/runs/12/${action}`),
]

describe('isHeavyRoute', () => {
  it.each(READS.flatMap(path => ['GET', 'HEAD'].map(method => [method, path])))('%s %s is heavy', (method, path) => {
    expect(isHeavyRoute(method!, path!)).toBe(true)
  })
  it.each(WRITES)('POST %s is heavy', path => {
    expect(isHeavyRoute('POST', path)).toBe(true)
  })
  it.each([
    ...WRITES.flatMap(path => ['GET', 'PUT', 'PATCH', 'DELETE'].map(method => [method, path])),
    ...READS.flatMap(path => ['POST', 'PUT', 'DELETE'].map(method => [method, path])),
    ['GET', '/api/v1/finance/reports'],
    ['GET', '/api/v1/finance/reports/'],
    ['GET', '/api/v1/finance/reports/unknown-report'],
    ['GET', '/api/v1/finance/reports/trial-balance/'],
    ['GET', '/api/v1/finance/reports/trial-balance/extra'],
    ['GET', '/api/v1/finance/reports/vat-return/items/extra'],
    ['GET', '/api/v1/finance/reports/analytic/other'],
    ['GET', '/api/v1/finance/reports/Trial-Balance'],
    ['GET', '/API/V1/finance/reports/trial-balance'],
    ['get', '/api/v1/finance/reports/trial-balance'],
    ['GET', '/api/v1/finance/reports/trial-balance?x=1'],
    ['GET', '/prefix/api/v1/finance/reports/trial-balance'],
    ['POST', '/api/v1/finance/invoices/post'],
    ['POST', '/api/v1/finance/invoices/abc/post'],
    ['POST', '/api/v1/finance/invoices/3/post/extra'],
    ['POST', '/api/v1/finance/invoices/3/post-all'],
    ['POST', '/api/v1/finance/assets/compute-depreciation/now'],
    ['POST', '/api/v1/hr/payroll/runs/12/approve'],
    ['POST', '/api/v1/hr/payroll/runs/12/payment'],
    ['POST', '/api/v1/hr/payroll/runs/12/compute/extra'],
    ['GET', '/api/v1/hr/payroll/runs/12/payslips'],
    ['GET', '/api/v1/hr/payroll/runs/12/bank-file/x'],
    ['GET', '/api/v1/hr/payroll/runs/12'],
    ['GET', '/api/v1/reports/projects'],
    ['GET', '/api/v1/reports/projects/summary/extra'],
    ['GET', '/api/v1/meetings/7/minutes'],
    ['GET', '/api/v1/meetings/7/minutes.pdf/extra'],
    ['GET', '/api/v1/meetings/x/minutes.pdf'],
    ['GET', '/api/v1/finance/invoices/7/pdfs'],
    ['POST', '/api/v1/auth/totp'],
    ['GET', '/api/v1/branding'],
    ['GET', '/api/v1/tasks'],
  ])('%s %s is not heavy', (method, path) => {
    expect(isHeavyRoute(method!, path!)).toBe(false)
  })
})

describe('NUXT_ODOO_HEAVY_TIMEOUT_MS', () => {
  async function heavyTimeout(value?: string) {
    vi.resetModules()
    if (value === undefined) vi.stubEnv('NUXT_ODOO_HEAVY_TIMEOUT_MS', '')
    else vi.stubEnv('NUXT_ODOO_HEAVY_TIMEOUT_MS', value)
    return (await import('../heavyRoutes')).HEAVY_TIMEOUT
  }
  it('defaults to 60s when missing or invalid', async () => {
    expect(await heavyTimeout()).toBe(60_000)
    expect(await heavyTimeout('garbage')).toBe(60_000)
    expect(await heavyTimeout('Infinity')).toBe(60_000)
  })
  it('accepts an override', async () => {
    expect(await heavyTimeout('90000')).toBe(90_000)
  })
  it('clamps to the 15s..120s range', async () => {
    expect(await heavyTimeout('1000')).toBe(15_000)
    expect(await heavyTimeout('-5')).toBe(15_000)
    expect(await heavyTimeout('9999999')).toBe(120_000)
  })
})
