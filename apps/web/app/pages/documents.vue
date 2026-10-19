<script setup lang="ts">
import type { LocationQueryRaw, RouteLocationNormalized } from 'vue-router'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import { useDocuments, useDocumentContexts, useDocumentContextOptions } from '@/composables/useDocuments'
import DocumentList from '@/components/documents/DocumentList.vue'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { refDebounced } from '@vueuse/core'
import { documentKpiTiles } from '@/utils/documentKpis'
import { DOCUMENT_EXPIRING_DAYS, documentCommittedListParams, hasPendingDocumentSearch } from '@/lib/documentKeys'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isListRoute = computed(() => {
  const rest = normalizedPath.value.replace(/^\/documents/, '')
  return rest === '' || rest === '/new'
})
const search = ref(String(route.query.q ?? ''))
const debouncedSearch = refDebounced(search, 250)
const hasPendingSearch = computed(() => hasPendingDocumentSearch(search.value, route.query.q))
const committedListParams = computed(() => documentCommittedListParams(route.query))
const contextId = ref(route.query.context_id ? Number(route.query.context_id) : undefined)
const limit = 25
const offset = ref(Math.max(0, Number(route.query.offset ?? 0) || 0))
const params = computed(() => {
  const query = route.query
  const context = typeof query.context_id === 'string' ? Number(query.context_id) : NaN
  const validContext = Number.isSafeInteger(context) && context > 0 && typeof query.context_kind === 'string'
  return {
    ...documentCommittedListParams(query),
    context_id: validContext ? context : undefined,
    context_kind: validContext ? String(query.context_kind) : undefined,
    archived: can('documents.items.archive') && query.archived === '1',
    limit,
  }
})
const query = useDocuments(params, isListRoute)
// The KPI tiles are the server totals of the unfiltered lists (one row asked for, its `total`), so the filters and paging below do not move them.
const canArchive = computed(() => can('documents.items.archive'))
const totalQuery = useDocuments({ limit: 1 }, isListRoute)
const archivedQuery = useDocuments({ limit: 1, archived: true }, computed(() => isListRoute.value && canArchive.value))
const restrictedQuery = useDocuments({ limit: 1, visibility: 'restricted' }, isListRoute)
const expiringQuery = useDocuments({ limit: 1, expiring_within: DOCUMENT_EXPIRING_DAYS }, isListRoute)
const expiredQuery = useDocuments({ limit: 1, expired: true }, isListRoute)
const kpiTiles = computed(() => documentKpiTiles({
  total: totalQuery.data.value?.total ?? null,
  archived: canArchive.value ? archivedQuery.data.value?.total ?? null : undefined,
  restricted: restrictedQuery.data.value?.total ?? null,
  expiring: expiringQuery.data.value?.total ?? null,
  expired: expiredQuery.data.value?.total ?? null,
}, t))
const contexts = useDocumentContexts(isListRoute)
const contextKind = ref(typeof route.query.context_kind === 'string' ? route.query.context_kind : '')
const provider = computed(() => can('documents.items.manage') && contexts.data.value?.items.some(item => item.kind === contextKind.value) ? contextKind.value : null)
const options = useDocumentContextOptions(provider)
const contextOptions = computed(() => [{ value: 'all', label: t('documents.allContexts') }, ...(options.data.value?.items ?? []).map(item => ({ value: String(item.id), label: item.name }))])
const page = computed(() => Math.floor(committedListParams.value.offset / limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
// The list's total as a tag in the heading, once the first page has arrived.
const countTags = computed(() => query.data.value ? [{ label: t('documents.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
const showEmpty = computed(() => !query.isLoading.value && !query.error.value && items.value.length === 0)
// Visibility and expiry filters live in the URL only (the KPI tiles link to them); the selects below read and write it.
const visibility = computed(() => committedListParams.value.visibility ?? 'all')
const expiryScope = computed(() => committedListParams.value.expired ? 'expired' : committedListParams.value.expiring_within ? 'expiring' : 'all')
const visibilityItems = computed(() => [{ value: 'all', label: t('documents.filter.anyVisibility') }, { value: 'company', label: t('documents.visibilityOptions.company') }, { value: 'restricted', label: t('documents.visibilityOptions.restricted') }])
const expiryItems = computed(() => [{ value: 'all', label: t('documents.filter.anyExpiry') }, { value: 'expiring', label: t('documents.kpi.expiring', { days: DOCUMENT_EXPIRING_DAYS }) }, { value: 'expired', label: t('documents.kpi.expired') }])
const activeFilterCount = computed(() => Number(visibility.value !== 'all') + Number(expiryScope.value !== 'all') + Number(Boolean(search.value.trim())) + Number(Boolean(contextKind.value)) + Number(Boolean(contextId.value)))

let pendingSearch: string | null = null
let pendingNavigation: RouteLocationNormalized | null = null
let lastPushed: { q: string; contextId: number | undefined; offset: number } | null = null
let writesInFlight = 0
let lastWrite = 0
let disposed = false
function isCurrentList() { return (router.currentRoute.value.path.replace(/\/+$/, '') || '/') === '/documents' }
const stopNavigationStart = useNuxtApp().hook('webvue:navigation:start', to => { pendingNavigation = to })
function settleNavigation(to: RouteLocationNormalized) {
  if (to !== pendingNavigation) return
  pendingNavigation = null
  if (!writesInFlight) queueMicrotask(flushSearch)
}
const stopAfterEach = router.afterEach(to => settleNavigation(to))
const stopOnError = router.onError((_error, to) => settleNavigation(to))
onScopeDispose(() => { disposed = true; stopNavigationStart(); stopAfterEach(); stopOnError() })
function writeListQuery(query: LocationQueryRaw) {
  if (!isCurrentList() || disposed) return
  const write = ++lastWrite
  lastPushed = {
    q: String(query.q ?? ''),
    contextId: query.context_id ? Number(query.context_id) : undefined,
    offset: Math.max(0, Number(query.offset ?? 0) || 0),
  }
  writesInFlight++
  void router.replace({ query, hash: router.currentRoute.value.hash })
    .then(failure => { if (failure && write === lastWrite) lastPushed = null })
    .catch(() => { if (write === lastWrite) lastPushed = null })
    .finally(() => { writesInFlight--; flushSearch() })
}
function writeFilters(q: string, overrides: LocationQueryRaw = {}) {
  offset.value = 0
  writeListQuery({ ...route.query, q: q || undefined, context_id: contextId.value ?? undefined, context_kind: contextKind.value || undefined, offset: undefined, ...overrides })
}
function flushSearch() {
  if (disposed || pendingNavigation || writesInFlight || !isCurrentList() || pendingSearch === null) return
  const next = pendingSearch
  pendingSearch = null
  if (next === String(route.query.q ?? '').trim()) return
  writeFilters(next)
}
watch(() => route.query.context_kind, value => { contextKind.value = typeof value === 'string' ? value : '' })
watch(() => [route.query.q, route.query.context_id, route.query.offset], ([q, department, nextOffset]) => {
  const next = {
    q: String(q ?? ''),
    contextId: department ? Number(department) : undefined,
    offset: Math.max(0, Number(nextOffset ?? 0) || 0),
  }
  if (lastPushed && next.q === lastPushed.q && next.contextId === lastPushed.contextId && next.offset === lastPushed.offset) lastPushed = null
  else {
    pendingSearch = null
    search.value = next.q
  }
  contextId.value = next.contextId
  offset.value = next.offset
})
watch(debouncedSearch, value => { pendingSearch = value.trim(); flushSearch() })

function updateFilters() {
  if (!isCurrentList() || disposed) return
  writeFilters(search.value.trim())
}
function onKindChange(value: unknown) {
  contextKind.value = String(value) === 'all' ? '' : String(value)
  contextId.value = undefined
  writeListQuery({ ...route.query, context_kind: contextKind.value || undefined, context_id: undefined, offset: undefined })
}
function onContextChange(value: unknown) {
  contextId.value = value && value !== 'all' ? Number(value) : undefined
  updateFilters()
}
function clearSearch() {
  search.value = ''
  updateFilters()
}
function onVisibilityChange(value: unknown) {
  writeListQuery({ ...route.query, visibility: value === 'all' ? undefined : String(value), offset: undefined })
}
function onExpiryChange(value: unknown) {
  writeListQuery({ ...route.query, expiring_within: value === 'expiring' ? String(DOCUMENT_EXPIRING_DAYS) : undefined, expired: value === 'expired' ? '1' : undefined, offset: undefined })
}
function clearFilters() {
  search.value = ''
  contextId.value = undefined
  contextKind.value = ''
  if (!isCurrentList() || disposed) return
  writeFilters('', { visibility: undefined, expiring_within: undefined, expired: undefined })
}
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || hasPendingSearch.value || next < 1 || next > pages.value) return
  if (!isCurrentList() || disposed) return
  offset.value = (next - 1) * limit
  writeListQuery({ ...route.query, q: search.value.trim() || undefined, context_id: contextId.value ?? undefined, context_kind: contextKind.value || undefined, offset: offset.value > 0 ? offset.value : undefined })
}
const liveListQuery = computed(() => {
  const { returnTo: _referrer, ...context } = route.query
  return { ...context, q: search.value.trim() || undefined, context_id: contextId.value ?? undefined, context_kind: contextKind.value || undefined, offset: !hasPendingSearch.value && offset.value > 0 ? offset.value : undefined }
})
const liveListPath = computed(() => router.resolve({ path: '/documents', query: liveListQuery.value, hash: route.hash }).fullPath)
// The create panel (documents/new.vue) returns to this list with the state it was showing and drops a
// referrer's returnTo, so the link carries the list state only (context_id preselects its department).
const createTo = computed(() => {
  if (!can('documents.items.manage')) return undefined
  return { path: '/documents/new', query: liveListQuery.value, ...(route.hash ? { hash: route.hash } : {}) }
})
function openLiveCreate(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  if (!hydrated.value || disposed || !isCurrentList() || !can('documents.items.manage')) return
  if (!(event.target instanceof Element) || !event.target.closest('[data-shortcut-create]')) return
  const target = createTo.value
  if (!target) return
  event.preventDefault()
  void router.push(target).catch(() => undefined)
}
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    :title="t('documents.title')"
    :tags="countTags"
    :create-to="createTo"
    :create-label="t('documents.new')"
    create-test-id="document-new"
    kpi-toggle
    @click.capture="openLiveCreate"
  >
    <SharedKpiStrip :tiles="kpiTiles" :loading="totalQuery.isLoading.value" :label="t('documents.kpi.label')" data-testid="document-kpi-strip" />
    <SharedListCard>
      <template #filters>
        <div class="w-full min-w-0" data-testid="documents-toolbar">
          <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
            <template #search>
              <UInput v-model="search" :disabled="!hydrated" :placeholder="t('documents.search')" :aria-label="t('documents.search')" icon="i-lucide-search" class="min-w-48 flex-1" @change="updateFilters">
                <template v-if="search" #trailing>
                  <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('documents.clearSearch')" class="-me-1" @click="clearSearch" />
                </template>
              </UInput>
            </template>
            <template #default>
              <USelect v-if="can('documents.items.manage') && contexts.data.value?.items.length" :model-value="contextKind || 'all'" :items="[{ value: 'all', label: t('documents.allContexts') }, ...contexts.data.value.items.map(item => ({ value: item.kind, label: item.label }))]" :aria-label="t('documents.context')" :disabled="!hydrated" @update:model-value="onKindChange" />
              <USelect :model-value="visibility" :items="visibilityItems" :aria-label="t('documents.visibility')" :disabled="!hydrated" data-testid="documents-visibility-filter" @update:model-value="onVisibilityChange" />
              <USelect :model-value="expiryScope" :items="expiryItems" :aria-label="t('documents.expiry')" :disabled="!hydrated" data-testid="documents-expiry-filter" @update:model-value="onExpiryChange" />
              <USelect
                v-if="provider" id="documents-context"
                class="w-full md:w-48"
                :model-value="contextId ? String(contextId) : 'all'"
                :items="contextOptions"
                :aria-label="t('documents.contextRecord')"
                :disabled="!hydrated"
                @update:model-value="onContextChange"
              />
            </template>
            <template #actions><UButton v-if="can('documents.items.archive')" color="neutral" variant="outline" :label="t(route.query.archived === '1' ? 'documents.active' : 'documents.archived')" :disabled="!hydrated" @click="writeListQuery({ ...route.query, archived: route.query.archived === '1' ? undefined : '1', offset: undefined })" /></template>
          </FilterBar>
        </div>
      </template>
      <SharedPageState :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t(activeFilterCount ? 'documents.noResults' : params.archived ? 'documents.emptyArchive' : 'documents.empty')" :description="t(activeFilterCount ? 'documents.noResultsHelp' : 'documents.emptyHelp')">
          <template #icon><UIcon :name="activeFilterCount ? 'i-lucide-search' : 'i-lucide-files'" class="size-6" /></template>
          <template v-if="activeFilterCount || (createTo && !params.archived)" #action>
            <UButton v-if="activeFilterCount" type="button" color="neutral" variant="outline" :label="t('documents.clearFilters')" :disabled="!hydrated" @click="clearFilters" />
            <UButton v-else :to="createTo" icon="i-lucide-plus" :label="t('documents.createFirst')" :disabled="!hydrated" />
          </template>
        </SharedEmptyState>
        <DocumentList v-else :documents="items" :loading="query.isLoading.value" :return-to="liveListPath" />
      </SharedPageState>
      <template v-if="query.data.value && !showEmpty" #footer>
        <SharedListFooter :count-label="t('documents.footer.results', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="query.isFetching.value || hasPendingSearch" @update:page="setPage" />
      </template>
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
