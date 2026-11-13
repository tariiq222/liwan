import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INBOX_LIST_ROUTE, type InboxListRoute } from '../inboxListRoute'

// The export is a download of the list's own filters without its page window; the file saved is the one the server named.
const saveBlob = vi.fn()
vi.mock('../../../utils/saveBlob', () => ({ saveBlob: (...args: unknown[]) => saveBlob(...args) }))
vi.mock('@tanstack/vue-query', () => ({ useMutation: (options: unknown) => options }))

const $download = vi.fn()
const { inboxExportQuery, useInboxConversationsExport } = await import('../useInboxConversationsExport')

const route = (patch: Partial<InboxListRoute> = {}): InboxListRoute => ({ ...DEFAULT_INBOX_LIST_ROUTE, offset: 60, ...patch })
const exporter = () => useInboxConversationsExport() as unknown as { mutationFn: (state: InboxListRoute) => Promise<void> }

beforeEach(() => {
  saveBlob.mockClear()
  $download.mockReset()
  vi.stubGlobal('useApi', () => ({ $download }))
})

describe('inboxExportQuery', () => {
  it('carries the list filters and leaves out the page window', () => {
    expect(inboxExportQuery(route({ assignee: 'me', state: 'open', q: 'أحمد', departmentId: 3 }))).toEqual({ assignee: 'me', state: 'open', department_id: 3, q: 'أحمد' })
  })

  it('is empty when no filter is set', () => {
    expect(inboxExportQuery(route())).toEqual({})
  })
})

describe('useInboxConversationsExport', () => {
  it('downloads the export of the given filters and saves it under the server file name', async () => {
    const blob = new Blob(['a'])
    $download.mockResolvedValue({ blob, filename: 'conversations-2026-11-13.csv' })
    await exporter().mutationFn(route({ state: 'open' }))
    expect($download).toHaveBeenCalledWith('/api/v1/inbox/conversations/export.csv', { query: { state: 'open' } })
    expect(saveBlob).toHaveBeenCalledWith(blob, 'conversations-2026-11-13.csv')
  })

  it('falls back to a file name when the server names none', async () => {
    const blob = new Blob(['a'])
    $download.mockResolvedValue({ blob, filename: null })
    await exporter().mutationFn(route())
    expect(saveBlob).toHaveBeenCalledWith(blob, 'inbox-conversations.csv')
  })

  it('saves nothing when the download is refused', async () => {
    $download.mockRejectedValue(new Error('too large'))
    await expect(exporter().mutationFn(route())).rejects.toThrow('too large')
    expect(saveBlob).not.toHaveBeenCalled()
  })
})
