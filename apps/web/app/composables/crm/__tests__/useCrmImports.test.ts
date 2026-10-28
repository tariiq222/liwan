import { beforeEach, describe, expect, it, vi } from 'vitest'
import { crmKeys } from '../crmKeys'

// Importing creates opportunities and a batch: their lists and the dashboard refetch. Reading the columns, the preview
// and saving a mapping touch none of those.
const invalidate = vi.fn(async (_filters: unknown) => undefined)
const options: { mutationFn: (v: never) => Promise<unknown>; onSuccess?: () => Promise<unknown> }[] = []
vi.mock('@tanstack/vue-query', () => ({
  useQuery: () => ({}),
  keepPreviousData: {},
  useQueryClient: () => ({ invalidateQueries: invalidate }),
  useMutation: (config: (typeof options)[number]) => { options.push(config); return config },
}))

const api = vi.fn()
const { useCrmImportActions } = await import('../useCrmImports')

beforeEach(() => {
  options.length = 0
  invalidate.mockClear()
  api.mockReset()
  vi.stubGlobal('useApi', () => ({ $api: api }))
})

const keys = () => invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey)

describe('useCrmImportActions', () => {
  it('refetches the batches, the opportunity lists and the dashboard after an import', async () => {
    const actions = useCrmImportActions()
    await (actions.commit as unknown as (typeof options)[number]).onSuccess!()
    expect(keys()).toEqual([crmKeys.importBatchesAll, [...crmKeys.opportunities, 'list'], crmKeys.dashboardAll])
  })
  it('refetches only the saved mappings after saving or deleting one', async () => {
    const actions = useCrmImportActions()
    for (const mutation of [actions.saveMapping, actions.deleteMapping]) {
      invalidate.mockClear()
      await (mutation as unknown as (typeof options)[number]).onSuccess!()
      expect(keys()).toEqual([crmKeys.importMappings])
    }
  })
  it('posts the file, the request and the profile to their routes', async () => {
    const actions = useCrmImportActions()
    api.mockResolvedValue({})
    await (actions.columns as unknown as (typeof options)[number]).mutationFn({ file_name: 'a.csv', content_base64: 'eA==' } as never)
    await (actions.preview as unknown as (typeof options)[number]).mutationFn({ file_name: 'a.csv' } as never)
    await (actions.deleteMapping as unknown as (typeof options)[number]).mutationFn(7 as never)
    expect(api.mock.calls.map(([path, init]) => [path, init.method])).toEqual([
      ['/api/v1/crm/imports/columns', 'POST'],
      ['/api/v1/crm/imports/preview', 'POST'],
      ['/api/v1/crm/import-mappings/7', 'DELETE'],
    ])
  })
})
