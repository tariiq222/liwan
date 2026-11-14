import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ProductListSchema, ProductSchema, type Product, type ProductCreate, type ProductPatch } from '@liwan/contracts'
import { productKeys } from './productKeys'
import { productApiQuery, type ProductListState } from './productListParams'

export function useProducts(state: MaybeRefOrGetter<ProductListState>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => productKeys.list(toValue(state))),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/products', { query: productApiQuery(toValue(state)), schema: ProductListSchema }),
  })
}

export function useProduct(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => productKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/products/${toValue(id)}`, { schema: ProductSchema }),
  })
}

/** Every write answers the product as saved: it replaces the record's cache entry, and the lists and the pick list refetch. */
function useProductWrite<Args>(send: (api: ReturnType<typeof useApi>['$api'], args: Args) => Promise<Product>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: Args) => send($api, args),
    onSuccess: async (saved) => {
      qc.setQueryData(productKeys.detail(saved.id), saved)
      await qc.invalidateQueries({ queryKey: productKeys.all, predicate: query => query.queryKey[1] !== 'record' })
    },
  })
}

export const useCreateProduct = () => useProductWrite<ProductCreate>(
  (api, body) => api('/api/v1/products', { method: 'POST', body, schema: ProductSchema }),
)

export const useUpdateProduct = () => useProductWrite<{ id: number; patch: ProductPatch }>(
  (api, { id, patch }) => api(`/api/v1/products/${id}`, { method: 'PATCH', body: patch, schema: ProductSchema }),
)

export const useArchiveProduct = () => useProductWrite<number>(
  (api, id) => api(`/api/v1/products/${id}/archive`, { method: 'POST', schema: ProductSchema }),
)

export const useRestoreProduct = () => useProductWrite<number>(
  (api, id) => api(`/api/v1/products/${id}/restore`, { method: 'POST', schema: ProductSchema }),
)
