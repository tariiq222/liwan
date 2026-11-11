import { beforeEach, describe, expect, it, vi } from 'vitest'

// The export is a download of the list's own filters: the query must match what the list shows, and the file
// the browser saves is the one the server named (with a fallback name when it names none).
const saveBlob = vi.fn()
vi.mock('../../../utils/saveBlob', () => ({ saveBlob: (...args: unknown[]) => saveBlob(...args) }))
vi.mock('@tanstack/vue-query', () => ({ useMutation: (options: unknown) => options }))

const $download = vi.fn()
const { crmExportQuery, useCrmExport } = await import('../useCrmExport')

// The mocked `useMutation` returns its options, so the test reaches the mutation function they carry.
const exporter = () => useCrmExport() as unknown as { mutationFn: (query: Record<string, unknown>) => Promise<void> }

beforeEach(() => {
  saveBlob.mockClear()
  $download.mockReset()
  vi.stubGlobal('useApi', () => ({ $download }))
})

describe('crmExportQuery', () => {
  it('sends open opportunities when the address names no status, as the list shows them', () => {
    expect(crmExportQuery({})).toEqual({ status: 'open' })
  })

  it('carries every list filter and leaves out paging and view', () => {
    expect(crmExportQuery({
      q: '  أحمد  ', stage_id: '3', source_id: '2', user_id: '7', due: '1', unassigned: '1', needs_manager: '1',
      status: 'won', page: '4', view: 'board',
    })).toEqual({
      q: 'أحمد', stage_id: '3', source_id: '2', user_id: '7', due: 'true', unassigned: 'true', needs_manager: 'true', status: 'won',
    })
  })

  it('drops a flag that is not switched on and an unknown status', () => {
    expect(crmExportQuery({ due: '0', status: 'archived', stage_id: 'x' })).toEqual({ status: 'open' })
  })

  it('keeps all statuses when the list is set to all', () => {
    expect(crmExportQuery({ status: 'all' })).toEqual({ status: 'all' })
  })
})

describe('useCrmExport', () => {
  it('downloads the export of the given filters and saves it under the server file name', async () => {
    const blob = new Blob(['a'])
    $download.mockResolvedValue({ blob, filename: 'crm-opportunities-2026-11-11.csv' })
    await exporter().mutationFn({ stage_id: '3', page: '2' })
    expect($download).toHaveBeenCalledWith('/api/v1/crm/export', { query: { status: 'open', stage_id: '3' } })
    expect(saveBlob).toHaveBeenCalledWith(blob, 'crm-opportunities-2026-11-11.csv')
  })

  it('falls back to a file name when the server names none', async () => {
    const blob = new Blob(['a'])
    $download.mockResolvedValue({ blob, filename: null })
    await exporter().mutationFn({})
    expect(saveBlob).toHaveBeenCalledWith(blob, 'crm-opportunities.csv')
  })

  it('saves nothing when the download is refused', async () => {
    $download.mockRejectedValue(new Error('forbidden'))
    await expect(exporter().mutationFn({})).rejects.toThrow('forbidden')
    expect(saveBlob).not.toHaveBeenCalled()
  })
})
