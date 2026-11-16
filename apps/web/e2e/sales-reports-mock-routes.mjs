// Part of the isolated UI mock stack: the routes of the Sales reports, shaped like packages/contracts/src/sales/reports.ts and
// computed from the product lines of the Sales mock's own documents (handed in by sales-mock-routes.mjs), so a report always
// agrees with the list:
//  - the report needs `sales.reports.read` and `sales.read` (403 `forbidden`); the rows it counts are the ones the caller reads
//    under the visibility setting (the mock hands in only those);
//  - filters: `date_from`, `date_to` (YYYY-MM-DD, both included, 422 `invalid` on the field), `salesperson_id`, `customer_id`,
//    `product_id`, `state` (wire states) and `source`; the breakdown and the export count confirmed orders when `state` is absent,
//    the summary every state;
//  - `GET .../summary` gives the confirmed, quotation (draft and sent) and cancelled groups; `GET .../breakdown?by=` groups by
//    `period` (`period=day|week|month`, oldest first), `salesperson`, `customer` or `product` (largest total first) with
//    `limit` and `offset`; `GET .../export` is the CSV of the rows behind the filters (newest first, formulas quoted).
const SUMMARY = '/api/v1/sales/reports/summary'
const BREAKDOWN = '/api/v1/sales/reports/breakdown'
const EXPORT = '/api/v1/sales/reports/export'
const STATES = ['draft', 'sent', 'confirmed', 'cancelled']
const SOURCES = ['staff', 'online']
const DIMENSIONS = ['period', 'salesperson', 'customer', 'product']
const PERIODS = ['day', 'week', 'month']
const GROUPS = { confirmed: ['confirmed'], quotations: ['draft', 'sent'], cancelled: ['cancelled'] }
const COLUMNS = ['number', 'date', 'state', 'source', 'customer', 'salesperson', 'product', 'quantity', 'unit_price', 'discount_percent', 'amount_untaxed', 'amount_total', 'currency']
const CURRENCY = { id: 2, name: 'SAR', symbol: 'ر.س' }
const DAY = /^\d{4}-\d{2}-\d{2}$/
const FORMULA = /^[=+\-@\t\r]/
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const round2 = value => Math.round(value * 100) / 100

class Refused extends Error {
  constructor(field, message) { super(message); this.field = field }
}

function positive(value, field) {
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new Refused(field, `${field} must be an integer`)
  return Number(value)
}

function day(value, field) {
  if (!DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Refused(field, `${field} must be YYYY-MM-DD or null`)
  return value
}

function parseFilters(params, defaultStates) {
  const filters = {}
  for (const key of ['date_from', 'date_to']) if (params.get(key)) filters[key] = day(params.get(key), key)
  if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) throw new Refused('date_from', 'date_from must not be after date_to')
  for (const key of ['salesperson_id', 'customer_id', 'product_id']) if (params.get(key)) filters[key] = positive(params.get(key), key)
  const wanted = params.get('state') ? params.get('state').split(',') : defaultStates
  if (wanted) {
    if (!wanted.every(state => STATES.includes(state))) throw new Refused('state', `state must be one or more of ${STATES.join(', ')}`)
    filters.states = wanted
  }
  if (params.get('source')) {
    if (!SOURCES.includes(params.get('source'))) throw new Refused('source', `source must be one of ${SOURCES.join(', ')}`)
    filters.source = params.get('source')
  }
  return filters
}

const keep = (row, filters) => (!filters.date_from || row.date.slice(0, 10) >= filters.date_from)
  && (!filters.date_to || row.date.slice(0, 10) <= filters.date_to)
  && (!filters.salesperson_id || row.salesperson?.id === filters.salesperson_id)
  && (!filters.customer_id || row.customer.id === filters.customer_id)
  && (!filters.product_id || row.product.id === filters.product_id)
  && (!filters.states || filters.states.includes(row.state))
  && (!filters.source || row.source === filters.source)

function totals(rows) {
  return {
    orders: new Set(rows.map(row => row.orderId)).size,
    amount_untaxed: round2(rows.reduce((sum, row) => sum + row.amount_untaxed, 0)),
    amount_total: round2(rows.reduce((sum, row) => sum + row.amount_total, 0)),
  }
}

/** The ISO day a period starts on: the day itself, the Sunday of its week, or the first of its month. */
function periodStart(date, period) {
  const start = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  if (period === 'month') start.setUTCDate(1)
  if (period === 'week') start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  return start.toISOString().slice(0, 10)
}

function groupOf(row, by, period) {
  if (by === 'period') { const key = periodStart(row.date, period); return { key, label: key } }
  const target = by === 'salesperson' ? row.salesperson : by === 'customer' ? row.customer : row.product
  return target ? { key: target.id, label: target.name } : { key: null, label: null }
}

function breakdown(rows, by, period, limit, offset) {
  const groups = new Map()
  for (const row of rows) {
    const { key, label } = groupOf(row, by, period)
    const id = String(key)
    groups.set(id, { key, label, rows: [...(groups.get(id)?.rows ?? []), row] })
  }
  const items = [...groups.values()].map(group => ({
    key: group.key, label: group.label, ...totals(group.rows), quantity: by === 'product' ? group.rows.reduce((sum, row) => sum + row.quantity, 0) : null,
  })).sort((a, b) => by === 'period' ? String(a.key).localeCompare(String(b.key)) : b.amount_total - a.amount_total)
  const shaped = items.map(({ key, label, orders, quantity, amount_untaxed, amount_total }) => ({ key, label, orders, quantity, amount_untaxed, amount_total }))
  return { by, period: by === 'period' ? period : null, currency: CURRENCY, items: shaped.slice(offset, offset + limit), total: shaped.length }
}

const cell = value => (typeof value === 'string' && FORMULA.test(value) ? `'${value}` : value)
const csvField = value => (/[",\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value))

function exportCsv(rows) {
  const lines = [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.lineId - a.lineId).map(row => [
    row.number, row.date, row.state, row.source, cell(row.customer.name), cell(row.salesperson?.name ?? ''), cell(row.product.name),
    row.quantity, row.unit_price, row.discount_percent, row.amount_untaxed, row.amount_total, CURRENCY.name,
  ].map(csvField).join(','))
  return `﻿${[COLUMNS.join(','), ...lines].join('\n')}\n`
}

/**
 * Answers a report request and returns true; any other path is not this stub's. `caps` are the session's Sales capabilities;
 * `rowsFor(caps)` hands in the product lines of the documents the session reads, as `{lineId, orderId, number, state, source,
 * date, customer, salesperson, product, quantity, unit_price, discount_percent, amount_untaxed, amount_total}`.
 */
export function handleSalesReports(req, res, path, url, json, caps, rowsFor) {
  if (![SUMMARY, BREAKDOWN, EXPORT].includes(path) || req.method !== 'GET') return false
  if (!caps.includes('sales.reports.read') || !caps.includes('sales.read')) {
    json(res, 403, { code: 'forbidden', message: 'forbidden' })
    return true
  }
  try {
    const params = url.searchParams
    const rows = rowsFor(caps)
    if (path === SUMMARY) {
      const kept = rows.filter(row => keep(row, parseFilters(params, null)))
      json(res, 200, { currency: CURRENCY, ...Object.fromEntries(Object.entries(GROUPS).map(([name, states]) => [name, totals(kept.filter(row => states.includes(row.state)))])) })
      return true
    }
    const filters = parseFilters(params, ['confirmed'])
    if (path === EXPORT) {
      const body = exportCsv(rows.filter(row => keep(row, filters)))
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sales-report-2026-11-14.csv"', 'Cache-Control': 'private, no-store' })
      res.end(body)
      return true
    }
    const by = params.get('by')
    if (!DIMENSIONS.includes(by)) throw new Refused('by', `by must be one of ${DIMENSIONS.join(', ')}`)
    const period = params.get('period') || 'month'
    if (!PERIODS.includes(period)) throw new Refused('period', `period must be one of ${PERIODS.join(', ')}`)
    const limit = Math.min(Number(params.get('limit') || DEFAULT_LIMIT) || DEFAULT_LIMIT, MAX_LIMIT)
    const offset = Number(params.get('offset') || 0) || 0
    json(res, 200, breakdown(rows.filter(row => keep(row, filters)), by, period, limit, offset))
  } catch (failure) {
    if (!(failure instanceof Refused)) throw failure
    json(res, 422, { code: 'invalid', message: failure.message, field: failure.field })
  }
  return true
}
