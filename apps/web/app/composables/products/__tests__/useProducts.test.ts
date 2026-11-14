import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductListSchema, ProductSchema, ProductSettingsSchema, ProductTaxChoiceListSchema } from '@liwan/contracts'

// vue-query is replaced by the options each composable hands it, so the request each one sends can be read and run.
const setQueryData = vi.fn()
const invalidateQueries = vi.fn()
vi.mock('@tanstack/vue-query', () => ({
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ setQueryData, invalidateQueries }),
  keepPreviousData: 'keep',
}))

const $api = vi.fn()
const { useProducts, useProduct, useCreateProduct, useUpdateProduct, useArchiveProduct, useRestoreProduct } = await import('../useProducts')
const { useProductSettings, useSaveProductSettings } = await import('../useProductSettings')
const { useProductTaxChoices } = await import('../useProductTaxChoices')

type Options = { queryFn: () => Promise<unknown>; queryKey: { value: readonly unknown[] }; enabled?: { value: boolean }; mutationFn: (args: unknown) => Promise<unknown>; onSuccess: (saved: { id: number }) => Promise<void> }
const as = (value: unknown) => value as Options

beforeEach(() => {
  $api.mockReset()
  setQueryData.mockReset()
  invalidateQueries.mockReset()
  vi.stubGlobal('useApi', () => ({ $api }))
  vi.stubGlobal('useMe', () => ({ me: { value: { company: { id: 4 } } } }))
})

describe('product reads', () => {
  it('lists a page with its filters, as limit and offset, under the contract schema', async () => {
    const query = as(useProducts({ q: 'عسل', type: 'goods', archived: false, page: 2 }))
    await query.queryFn()
    expect($api).toHaveBeenCalledWith('/api/v1/products', { query: { q: 'عسل', type: 'goods', limit: 25, offset: 25 }, schema: ProductListSchema })
    expect(query.queryKey.value).toEqual(['products', 'list', { q: 'عسل', type: 'goods', archived: false, page: 2 }])
  })

  it('reads one product by id, and waits for an id', async () => {
    const query = as(useProduct(7))
    await query.queryFn()
    expect($api).toHaveBeenCalledWith('/api/v1/products/7', { schema: ProductSchema })
    expect(query.enabled?.value).toBe(true)
    expect(as(useProduct(null)).enabled?.value).toBe(false)
  })

  it('reads the settings and the tax choices of the working company, the taxes only when asked', async () => {
    const settings = as(useProductSettings())
    await settings.queryFn()
    expect($api).toHaveBeenCalledWith('/api/v1/products/settings', { schema: ProductSettingsSchema })
    expect(settings.queryKey.value).toEqual(['products', 'settings', { companyId: 4 }])
    const taxes = as(useProductTaxChoices(() => false))
    await taxes.queryFn()
    expect($api).toHaveBeenCalledWith('/api/v1/products/taxes', { schema: ProductTaxChoiceListSchema })
    expect(taxes.enabled?.value).toBe(false)
    expect(as(useProductTaxChoices(() => true)).enabled?.value).toBe(true)
  })
})

describe('product writes', () => {
  it('sends each write to its route with the contract schema', async () => {
    await as(useCreateProduct()).mutationFn({ name: 'x', type: 'goods' })
    expect($api).toHaveBeenLastCalledWith('/api/v1/products', { method: 'POST', body: { name: 'x', type: 'goods' }, schema: ProductSchema })
    await as(useUpdateProduct()).mutationFn({ id: 7, patch: { list_price: 9 } })
    expect($api).toHaveBeenLastCalledWith('/api/v1/products/7', { method: 'PATCH', body: { list_price: 9 }, schema: ProductSchema })
    await as(useArchiveProduct()).mutationFn(7)
    expect($api).toHaveBeenLastCalledWith('/api/v1/products/7/archive', { method: 'POST', schema: ProductSchema })
    await as(useRestoreProduct()).mutationFn(7)
    expect($api).toHaveBeenLastCalledWith('/api/v1/products/7/restore', { method: 'POST', schema: ProductSchema })
  })

  it('replaces the record and refetches the lists and the pick list, not the record just written', async () => {
    const write = as(useUpdateProduct())
    const saved = { id: 7 }
    await write.onSuccess(saved)
    expect(setQueryData).toHaveBeenCalledWith(['products', 'record', 7], saved)
    const { queryKey, predicate } = invalidateQueries.mock.calls[0]![0] as { queryKey: readonly unknown[]; predicate: (query: { queryKey: readonly unknown[] }) => boolean }
    expect(queryKey).toEqual(['products'])
    expect(predicate({ queryKey: ['products', 'list', {}] })).toBe(true)
    expect(predicate({ queryKey: ['products', 'pick', 'q'] })).toBe(true)
    expect(predicate({ queryKey: ['products', 'record', 7] })).toBe(false)
  })

  it('saves the settings with the revision and replaces the cached ones', async () => {
    const saved = { sharing: 'branch', can_manage: true, revision: 3 }
    $api.mockResolvedValue(saved)
    await expect(as(useSaveProductSettings()).mutationFn({ sharing: 'branch', revision: 2 })).resolves.toBe(saved)
    expect($api).toHaveBeenCalledWith('/api/v1/products/settings', { method: 'PATCH', body: { sharing: 'branch', revision: 2 }, schema: ProductSettingsSchema })
    expect(setQueryData).toHaveBeenCalledWith(['products', 'settings', { companyId: 4 }], saved)
  })
})
