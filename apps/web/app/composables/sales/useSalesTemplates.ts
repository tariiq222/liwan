import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  SalesTemplateCreateSchema,
  SalesTemplateListSchema,
  SalesTemplatePatchSchema,
  SalesTemplateSchema,
  type SalesTemplate,
  type SalesTemplateCreate,
  type SalesTemplatePatch,
} from '@liwan/contracts'
import { salesKeys } from './salesKeys'
import { SALES_TEMPLATE_PAGE_SIZE, type SalesTemplateListFilters } from './salesTemplateParams'

const apiQuery = (state: SalesTemplateListFilters) => ({
  ...(state.q ? { q: state.q } : {}),
  ...(state.archived ? { archived: 'true' } : {}),
  limit: SALES_TEMPLATE_PAGE_SIZE,
  offset: (state.page - 1) * SALES_TEMPLATE_PAGE_SIZE,
})

/**
 * The templates of the working company, by name. Whoever writes a quotation reads the active ones (the pick list);
 * a settings manager also reads the archived ones.
 */
export function useSalesTemplates(state: MaybeRefOrGetter<SalesTemplateListFilters>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => salesKeys.templateList(me.value?.company?.id, toValue(state))),
    enabled: computed(() => toValue(enabled) && !!me.value),
    placeholderData: keepPreviousData,
    queryFn: () => $api('/api/v1/sales/templates', { query: apiQuery(toValue(state)), schema: SalesTemplateListSchema }),
  })
}

export function useSalesTemplate(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => salesKeys.template(me.value?.company?.id, toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id) && !!me.value),
    queryFn: () => $api(`/api/v1/sales/templates/${toValue(id)}`, { schema: SalesTemplateSchema }),
  })
}

/**
 * Every write answers the template as saved: it replaces the record's cache entry and the lists refetch. The mutation
 * stays pending until the server answers. The body is checked against the contract before it leaves.
 */
function useSalesTemplateWrite<Args>(send: (api: ReturnType<typeof useApi>['$api'], args: Args) => Promise<SalesTemplate>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { me } = useMe()
  return useMutation({
    mutationFn: (args: Args) => send($api, args),
    onSuccess: async (saved) => {
      const company = me.value?.company?.id
      qc.setQueryData(salesKeys.template(company, saved.id), saved)
      await qc.invalidateQueries({ queryKey: salesKeys.templates(company), predicate: query => query.queryKey[3] === 'list' })
    },
  })
}

export const useCreateSalesTemplate = () => useSalesTemplateWrite<SalesTemplateCreate>(
  (api, body) => api('/api/v1/sales/templates', { method: 'POST', body: SalesTemplateCreateSchema.parse(body), schema: SalesTemplateSchema }),
)

export const useUpdateSalesTemplate = () => useSalesTemplateWrite<{ id: number; patch: SalesTemplatePatch }>(
  (api, { id, patch }) => api(`/api/v1/sales/templates/${id}`, { method: 'PATCH', body: SalesTemplatePatchSchema.parse(patch), schema: SalesTemplateSchema }),
)

/** Archiving takes a template out of the pick list; restoring puts it back. */
export const useMoveSalesTemplate = () => useSalesTemplateWrite<{ id: number; action: 'archive' | 'restore' }>(
  (api, { id, action }) => api(`/api/v1/sales/templates/${id}/${action}`, { method: 'POST', schema: SalesTemplateSchema }),
)
