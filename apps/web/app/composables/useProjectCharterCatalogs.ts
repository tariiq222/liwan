import type { MaybeRefOrGetter, Ref } from 'vue'
import { computed, onMounted, ref, toValue, watch } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { refDebounced } from '@vueuse/core'
import {
  ProjectCharterCatalogResourceSchema,
  ProjectCharterDefaultsSchema,
  ProjectCharterReferenceDeletedSchema,
  ProjectCharterReferenceListSchema,
  ProjectCharterReferenceSchema,
  type ProjectCharterCatalogResource,
  type ProjectCharterReference,
  type ProjectCharterReferenceCreate,
  type ProjectCharterReferenceList,
  type ProjectCharterReferencePatch,
} from '@liwan/contracts'

export type { ProjectCharterCatalogResource, ProjectCharterReference, ProjectCharterReferenceList }

export const CHARTER_CATALOG_PAGE_SIZE = 50

export const charterCatalogKeys = {
  all: ['project-charter'] as const,
  defaults: ['project-charter', 'defaults'] as const,
  list: (resource: string, params: Record<string, unknown>) => ['project-charter', 'catalogs', resource, params] as const,
  detail: (resource: string, id: number) => ['project-charter', 'catalogs', resource, 'item', id] as const,
}

export function isCharterCatalogResource(value: unknown): value is ProjectCharterCatalogResource {
  return ProjectCharterCatalogResourceSchema.safeParse(value).success
}

export function catalogCollectionPath(resource: ProjectCharterCatalogResource): string {
  return `/api/v1/project-charter/catalogs/${resource}`
}

export function catalogItemPath(resource: ProjectCharterCatalogResource, id: number): string {
  return `${catalogCollectionPath(resource)}/${id}`
}

export type CharterCatalogListParams = {
  q?: string
  active?: '1' | '0' | 'all'
  offset?: number
  limit?: number
}

export function useCharterDefaults(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: charterCatalogKeys.defaults,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/project-charter/defaults', { schema: ProjectCharterDefaultsSchema }),
  })
}

export function useCharterCatalogList(
  resource: MaybeRefOrGetter<ProjectCharterCatalogResource>,
  params: MaybeRefOrGetter<CharterCatalogListParams>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => charterCatalogKeys.list(toValue(resource), toValue(params))),
    enabled: computed(() => toValue(enabled) && isCharterCatalogResource(toValue(resource))),
    queryFn: () => {
      const query = toValue(params)
      return $api(catalogCollectionPath(toValue(resource)), {
        query: {
          q: query.q || undefined,
          active: query.active ?? '1',
          offset: query.offset ?? 0,
          limit: query.limit ?? CHARTER_CATALOG_PAGE_SIZE,
        },
        schema: ProjectCharterReferenceListSchema,
      })
    },
  })
}

export function useCharterCatalogItem(
  resource: MaybeRefOrGetter<ProjectCharterCatalogResource>,
  id: MaybeRefOrGetter<number | null>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => charterCatalogKeys.detail(toValue(resource), toValue(id) ?? 0)),
    enabled: computed(() => toValue(enabled) && !!toValue(id) && isCharterCatalogResource(toValue(resource))),
    queryFn: () => $api(catalogItemPath(toValue(resource), toValue(id)!), { schema: ProjectCharterReferenceSchema }),
  })
}

function invalidateCatalog(qc: ReturnType<typeof useQueryClient>, resource: ProjectCharterCatalogResource) {
  return qc.invalidateQueries({ queryKey: ['project-charter', 'catalogs', resource] })
}

export function useCreateCharterReference(resource: MaybeRefOrGetter<ProjectCharterCatalogResource>) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: ProjectCharterReferenceCreate) =>
      $api(catalogCollectionPath(toValue(resource)), { method: 'POST', body, schema: ProjectCharterReferenceSchema }),
    onSuccess: (item) => {
      qc.setQueryData(charterCatalogKeys.detail(toValue(resource), item.id), item)
      return invalidateCatalog(qc, toValue(resource))
    },
  })
}

export function useUpdateCharterReference(resource: MaybeRefOrGetter<ProjectCharterCatalogResource>) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ProjectCharterReferencePatch }) =>
      $api(catalogItemPath(toValue(resource), id), { method: 'PATCH', body: patch, schema: ProjectCharterReferenceSchema }),
    onSuccess: (item) => {
      qc.setQueryData(charterCatalogKeys.detail(toValue(resource), item.id), item)
      return invalidateCatalog(qc, toValue(resource))
    },
  })
}

export function useDeleteCharterReference(resource: MaybeRefOrGetter<ProjectCharterCatalogResource>) {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (id: number) =>
      $api(catalogItemPath(toValue(resource), id), { method: 'DELETE', schema: ProjectCharterReferenceDeletedSchema }),
    onSuccess: () => invalidateCatalog(qc, toValue(resource)),
  })
}

export function useCharterCatalogSearch(
  resource: MaybeRefOrGetter<ProjectCharterCatalogResource>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const { $api } = useApi()
  // This picker fetches outside the query cache. Start after mount so SSR
  // and the first client tree share the same idle state and loading icon.
  const ready = ref(false)
  onMounted(() => { ready.value = true })
  const q = ref('')
  const debouncedQ = refDebounced(q, 250)
  const items = ref<ProjectCharterReference[]>([])
  const total = ref(0)
  const pending = ref(false)
  const error = ref<unknown>(null)
  let requestGeneration = 0

  async function fetchPage(offset: number, replace: boolean) {
    const resourceValue = toValue(resource)
    const enabledValue = toValue(enabled)
    const queryValue = debouncedQ.value
    if (!ready.value || !enabledValue || !isCharterCatalogResource(resourceValue)) {
      pending.value = false
      return
    }
    const generation = ++requestGeneration
    const isCurrent = () => (
      generation === requestGeneration
      && resourceValue === toValue(resource)
      && enabledValue === toValue(enabled)
      && queryValue === debouncedQ.value
    )
    pending.value = true
    error.value = null
    try {
      const page = await $api(catalogCollectionPath(resourceValue), {
        query: {
          q: queryValue || undefined,
          active: '1',
          offset,
          limit: CHARTER_CATALOG_PAGE_SIZE,
        },
        schema: ProjectCharterReferenceListSchema,
      })
      if (!isCurrent()) return
      total.value = page.total
      items.value = replace ? page.items : mergeCatalogItems(items.value, page.items)
    }
    catch (e) {
      if (isCurrent()) error.value = e
    }
    finally {
      if (isCurrent()) pending.value = false
    }
  }

  watch(
    [ready, debouncedQ, () => toValue(resource), () => toValue(enabled)],
    () => {
      // Invalidate the previous request before clearing the visible result so
      // a late response cannot repopulate a newer query.
      requestGeneration += 1
      items.value = []
      total.value = 0
      void fetchPage(0, true)
    },
    { immediate: true },
  )

  const hasMore = computed(() => items.value.length < total.value)

  function loadMore() {
    if (!hasMore.value || pending.value) return
    void fetchPage(items.value.length, false)
  }

  return { q, items: items as Ref<ProjectCharterReference[]>, total, pending, error, hasMore, loadMore }
}

export function mergeCatalogItems(
  current: ProjectCharterReference[],
  incoming: ProjectCharterReference[],
): ProjectCharterReference[] {
  const seen = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) seen.set(item.id, item)
  return [...seen.values()]
}
