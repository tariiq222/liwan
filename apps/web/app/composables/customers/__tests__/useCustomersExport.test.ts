import { beforeEach, describe, expect, it, vi } from 'vitest'

// The export is a download of the list's own filters, saved under the name the server gave (a fallback when it gave none).
const saveBlob = vi.fn()
vi.mock('../../../utils/saveBlob', () => ({ saveBlob: (...args: unknown[]) => saveBlob(...args) }))
vi.mock('@tanstack/vue-query', () => ({ useMutation: (options: unknown) => options }))

const $download = vi.fn()
const { useCustomersExport } = await import('../useCustomersExport')
const exporter = () => useCustomersExport() as unknown as { mutationFn: (state: { q: string; archived: boolean }) => Promise<void> }

beforeEach(() => {
  saveBlob.mockClear()
  $download.mockReset()
  vi.stubGlobal('useApi', () => ({ $download }))
})

describe('useCustomersExport', () => {
  it('downloads the export of the list filters and saves it under the server file name', async () => {
    const blob = new Blob(['a'])
    $download.mockResolvedValue({ blob, filename: 'customers-2026-11-13.csv' })
    await exporter().mutationFn({ q: 'منى', archived: true })
    expect($download).toHaveBeenCalledWith('/api/v1/customers/export', { query: { q: 'منى', archived: 'true' } })
    expect(saveBlob).toHaveBeenCalledWith(blob, 'customers-2026-11-13.csv')
  })

  it('falls back to a fixed name and sends no filter for the default list', async () => {
    const blob = new Blob(['a'])
    $download.mockResolvedValue({ blob, filename: null })
    await exporter().mutationFn({ q: '', archived: false })
    expect($download).toHaveBeenCalledWith('/api/v1/customers/export', { query: {} })
    expect(saveBlob).toHaveBeenCalledWith(blob, 'customers.csv')
  })

  it('does not save a file when the export is refused', async () => {
    $download.mockRejectedValue(new Error('forbidden'))
    await expect(exporter().mutationFn({ q: '', archived: false })).rejects.toThrow('forbidden')
    expect(saveBlob).not.toHaveBeenCalled()
  })
})
