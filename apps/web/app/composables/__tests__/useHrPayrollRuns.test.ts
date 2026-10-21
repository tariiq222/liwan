import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/vue-query'
import type { HrPayrollRun, HrPayslipRow } from '@webvue/contracts'
import { ApiError } from '../useApi'
import { hrPayrollKeys } from '../useHrPayrollCompensation'
import {
  createHrPayrollRun,
  fetchAllHrPayslips,
  hrPayrollRunsQuery,
  patchHrPayslipInputs,
  transitionHrPayrollRun,
} from '../useHrPayrollRuns'

const run = { id: 4, month: '2026-10', state: 'computed', allowed_actions: ['approve'] } as HrPayrollRun
const approved = { ...run, state: 'approved', allowed_actions: [] } as HrPayrollRun
const row = (id: number, bonus: number) => ({ id, inputs: { bonus_amount: bonus }, net: 100 * id }) as HrPayslipRow

describe('hrPayrollKeys for runs', () => {
  it('nests list, detail and payslips under hr/payroll/runs', () => {
    expect(hrPayrollKeys.runLists).toEqual(['hr', 'payroll', 'runs', 'list'])
    expect(hrPayrollKeys.runList({ limit: 25 })).toEqual(['hr', 'payroll', 'runs', 'list', { limit: 25 }])
    expect(hrPayrollKeys.run(4)).toEqual(['hr', 'payroll', 'runs', 'detail', 4])
    expect(hrPayrollKeys.payslips(4, { q: 'ل' })).toEqual(['hr', 'payroll', 'runs', 4, 'payslips', { q: 'ل' }])
  })
})

describe('hrPayrollRunsQuery', () => {
  it('drops empty filters and bounds the page', () => {
    expect(hrPayrollRunsQuery({ year: null, state: 'all', offset: -5 })).toEqual({ year: undefined, state: undefined, limit: 25, offset: 0 })
    expect(hrPayrollRunsQuery({ year: 2026, state: 'draft', limit: 500, offset: 50 })).toEqual({ year: 2026, state: 'draft', limit: 100, offset: 50 })
  })
})

describe('createHrPayrollRun', () => {
  it('POSTs the month, caches the run and refreshes the lists', async () => {
    const qc = new QueryClient()
    const api = vi.fn().mockResolvedValue(run)
    expect(await createHrPayrollRun(api, qc, { month: '2026-10' })).toEqual(run)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/runs', { method: 'POST', body: { month: '2026-10' }, schema: expect.anything() })
    expect(qc.getQueryData(hrPayrollKeys.run(4))).toEqual(run)
  })

  it('keeps a duplicate month an ApiError for the form', async () => {
    const api = vi.fn().mockRejectedValue(new ApiError(422, 'duplicate', 'exists', 'month'))
    await expect(createHrPayrollRun(api, new QueryClient(), { month: '2026-10' })).rejects.toMatchObject({ code: 'duplicate', field: 'month' })
  })
})

describe('transitionHrPayrollRun', () => {
  it('approve stays pending until the server answers', async () => {
    const qc = new QueryClient()
    qc.setQueryData(hrPayrollKeys.run(4), run)
    let answer!: (value: HrPayrollRun) => void
    const api = vi.fn(() => new Promise<HrPayrollRun>((resolve) => { answer = resolve }))
    const call = api as never
    const pending = transitionHrPayrollRun(call, qc, 4, 'approve')
    await Promise.resolve()
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/runs/4/approve', { method: 'POST', body: {}, schema: expect.anything() })
    expect(qc.getQueryData<HrPayrollRun>(hrPayrollKeys.run(4))?.state).toBe('computed')
    answer(approved)
    await pending
    expect(qc.getQueryData<HrPayrollRun>(hrPayrollKeys.run(4))?.state).toBe('approved')
  })

  it('a refused approve leaves the cached run untouched', async () => {
    const qc = new QueryClient()
    qc.setQueryData(hrPayrollKeys.run(4), run)
    const api = vi.fn().mockRejectedValue(new ApiError(422, 'negative_net', 'negative', undefined, { employee_ids: [3] }))
    await expect(transitionHrPayrollRun(api, qc, 4, 'approve')).rejects.toMatchObject({ code: 'negative_net' })
    expect(qc.getQueryData<HrPayrollRun>(hrPayrollKeys.run(4))?.state).toBe('computed')
  })

  it('cancel DELETEs the run and drops it from the cache', async () => {
    const qc = new QueryClient()
    qc.setQueryData(hrPayrollKeys.run(4), run)
    const api = vi.fn().mockResolvedValue(undefined)
    await transitionHrPayrollRun(api, qc, 4, 'cancel')
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/runs/4', { method: 'DELETE' })
    expect(qc.getQueryData(hrPayrollKeys.run(4))).toBeUndefined()
  })

  it('compute POSTs and replaces the run', async () => {
    const qc = new QueryClient()
    const api = vi.fn().mockResolvedValue(run)
    await transitionHrPayrollRun(api, qc, 4, 'compute')
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/runs/4/compute', { method: 'POST', body: {}, schema: expect.anything() })
    expect(qc.getQueryData(hrPayrollKeys.run(4))).toEqual(run)
  })
})

describe('patchHrPayslipInputs', () => {
  it('inputs patch replaces the row with the server row', async () => {
    const qc = new QueryClient()
    const query = { limit: 25, offset: 0 }
    qc.setQueryData(hrPayrollKeys.payslips(4, query), { items: [row(8, 0), row(9, 0)], total: 2 })
    const serverRow = row(9, 250)
    const api = vi.fn().mockResolvedValue(serverRow)
    await patchHrPayslipInputs(api, qc, 4, 9, { bonus_amount: 250 })
    expect(api).toHaveBeenCalledWith('/api/v1/hr/payroll/runs/4/payslips/9/inputs', { method: 'PATCH', body: { bonus_amount: 250 }, schema: expect.anything() })
    const cached = qc.getQueryData<{ items: HrPayslipRow[] }>(hrPayrollKeys.payslips(4, query))
    expect(cached?.items[1]).toEqual(serverRow)
    expect(cached?.items[0]).toEqual(row(8, 0))
  })
})

describe('fetchAllHrPayslips', () => {
  it('loads every page of the run in 100-row chunks without a search filter', async () => {
    const all = Array.from({ length: 230 }, (_, index) => row(index + 1, 0))
    const api = vi.fn(async (_path: string, opts: { query: { limit: number; offset: number } }) => ({
      items: all.slice(opts.query.offset, opts.query.offset + opts.query.limit), total: all.length,
    }))
    const rows = await fetchAllHrPayslips(api as never, 4)
    expect(rows).toHaveLength(230)
    expect(api.mock.calls.map(call => call[1].query)).toEqual([{ limit: 100, offset: 0 }, { limit: 100, offset: 100 }, { limit: 100, offset: 200 }])
    expect(api.mock.calls[0]![0]).toBe('/api/v1/hr/payroll/runs/4/payslips')
  })

  it('stops on an empty page even when the total is larger', async () => {
    const api = vi.fn().mockResolvedValue({ items: [], total: 5 })
    expect(await fetchAllHrPayslips(api, 4)).toEqual([])
    expect(api).toHaveBeenCalledTimes(1)
  })
})
