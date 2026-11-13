import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../useApi'
import { customerPrivacyRefusal } from '../customerPrivacyErrors'
import { canRunErase, distinctReasons, groupPrivacyItems, knownPrivacyReason } from '../customerPrivacyView'

const blocker = { key: 'sale.order', owner: 'sale', reason: 'application_has_no_hook' }

describe('customerPrivacyRefusal', () => {
  it('names what to do for each code the privacy routes answer', () => {
    expect(customerPrivacyRefusal(new ApiError(409, 'erase_incomplete', 'x', undefined, { incomplete: [blocker] }))).toEqual({ kind: 'incomplete', incomplete: [blocker] })
    expect(customerPrivacyRefusal(new ApiError(422, 'invalid_token', 'x')).kind).toBe('token')
    expect(customerPrivacyRefusal(new ApiError(422, 'invalid', 'x', 'confirmation')).kind).toBe('confirmation')
    expect(customerPrivacyRefusal(new ApiError(422, 'invalid', 'x', 'reason')).kind).toBe('reason')
    expect(customerPrivacyRefusal(new ApiError(409, 'conflict', 'x')).kind).toBe('conflict')
    expect(customerPrivacyRefusal(new ApiError(403, 'forbidden', 'x')).kind).toBe('forbidden')
    expect(customerPrivacyRefusal(new ApiError(404, 'not_found', 'x')).kind).toBe('missing')
  })

  it('treats malformed details and any other failure as a generic one', () => {
    expect(customerPrivacyRefusal(new ApiError(409, 'erase_incomplete', 'x', undefined, { incomplete: [] })).kind).toBe('other')
    expect(customerPrivacyRefusal(new ApiError(500, 'server', 'x')).kind).toBe('other')
    expect(customerPrivacyRefusal(new Error('offline')).kind).toBe('other')
    expect(customerPrivacyRefusal(null).kind).toBe('other')
  })
})

describe('privacy view helpers', () => {
  const item = (key: string, action: 'erase' | 'retain' | 'unhandled') => ({ key, owner: 'o', action, count: 1, complete: true })

  it('groups the items by what the erase does and keeps their order', () => {
    const groups = groupPrivacyItems([item('a', 'erase'), item('b', 'retain'), item('c', 'erase'), item('d', 'unhandled')])
    expect(groups.erase.map(entry => entry.key)).toEqual(['a', 'c'])
    expect(groups.retain.map(entry => entry.key)).toEqual(['b'])
    expect(groups.unhandled.map(entry => entry.key)).toEqual(['d'])
  })

  it('lets the erase run only when nothing blocks it and the customer is not erased', () => {
    expect(canRunErase({ incomplete: [], customer: { id: 1, erased: false } })).toBe(true)
    expect(canRunErase({ incomplete: [blocker], customer: { id: 1, erased: false } })).toBe(false)
    expect(canRunErase({ incomplete: [], customer: { id: 1, erased: true } })).toBe(false)
  })

  it('lists each reason once, known ones first', () => {
    const reasons = distinctReasons([
      { ...blocker, reason: 'brand_new' }, { ...blocker, reason: 'caller_cannot_reach_all_records' }, blocker, blocker,
    ])
    expect(reasons).toEqual(['application_has_no_hook', 'caller_cannot_reach_all_records', 'brand_new'])
    expect(knownPrivacyReason('brand_new')).toBeNull()
  })
})

const saveBlob = vi.fn()
vi.mock('../../../utils/saveBlob', () => ({ saveBlob: (...args: unknown[]) => saveBlob(...args) }))
vi.mock('@tanstack/vue-query', () => ({ useMutation: (options: unknown) => options, useQueryClient: () => ({}) }))
const $download = vi.fn()
const $api = vi.fn()
const { useCustomerErasePreview, useExportCustomerPrivacy } = await import('../useCustomerPrivacy')

describe('useCustomerPrivacy', () => {
  beforeEach(() => {
    saveBlob.mockClear()
    $download.mockReset()
    $api.mockReset()
    vi.stubGlobal('useApi', () => ({ $api, $download }))
  })

  it('posts the export reason and saves the file under the server name', async () => {
    const blob = new Blob(['a'])
    $download.mockResolvedValue({ blob, filename: 'subject-7.xlsx' })
    const exporter = useExportCustomerPrivacy() as unknown as { mutationFn: (args: unknown) => Promise<void> }
    await exporter.mutationFn({ id: 7, body: { reason: 'request' } })
    expect($download).toHaveBeenCalledWith('/api/v1/customers/7/privacy/export', { method: 'POST', body: { reason: 'request' } })
    expect(saveBlob).toHaveBeenCalledWith(blob, 'subject-7.xlsx')
  })

  it('saves nothing when the export is refused', async () => {
    $download.mockRejectedValue(new ApiError(403, 'forbidden', 'x'))
    const exporter = useExportCustomerPrivacy() as unknown as { mutationFn: (args: unknown) => Promise<void> }
    await expect(exporter.mutationFn({ id: 7, body: { reason: 'r' } })).rejects.toThrow()
    expect(saveBlob).not.toHaveBeenCalled()
  })

  it('posts the preview without a body', async () => {
    $api.mockResolvedValue({})
    const preview = useCustomerErasePreview() as unknown as { mutationFn: (id: number) => Promise<unknown> }
    await preview.mutationFn(7)
    expect($api).toHaveBeenCalledWith('/api/v1/customers/7/privacy/erase-preview', expect.objectContaining({ method: 'POST' }))
  })
})
