<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { LocationQueryRaw, RouteLocationNormalized } from 'vue-router'
import FilterBar from '@/components/shared/FilterBar.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import { useHrDocuments, type HrDocument } from '@/composables/useHrDocuments'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { returnToQuery } from '@/utils/safeReturnTo'
import { refDebounced } from '@vueuse/core'
import { hasPendingHrSearch, hrCommittedListParams } from '@/composables/useHrSearch'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isListRoute = computed(() => {
  const rest = normalizedPath.value.replace(/^\/hr\/documents/, '')
  return rest === '' || rest === '/new'
})
const search = ref(String(route.query.q ?? ''))
const debouncedSearch = refDebounced(search, 250)
const hasPendingSearch = computed(() => hasPendingHrSearch(search.value, route.query.q))
const committedListParams = computed(() => hrCommittedListParams(route.query))
const departmentId = ref(route.query.department_id ? Number(route.query.department_id) : undefined)
const limit = 25
const offset = ref(Math.max(0, Number(route.query.offset ?? 0) || 0))
const params = computed(() => {
  const query = route.query
  const department = typeof query.department_id === 'string' ? Number(query.department_id) : NaN
  return {
    ...hrCommittedListParams(query),
    department_id: Number.isSafeInteger(department) && department > 0 ? department : undefined,
    limit,
  }
})
const query = useHrDocuments(params)
const departments = useHrDepartments()
const departmentOptions = computed(() => [{ value: 'all', label: t('hr.docs.allDepartments') }, ...(departments.data.value?.items ?? []).map(department => ({ value: String(department.id), label: department.name }))])
const page = computed(() => Math.floor(committedListParams.value.offset / limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))
const selectedDepartment = computed(() => departments.data.value?.items.find(department => department.id === departmentId.value))
const hasActiveFilters = computed(() => Boolean(search.value.trim() || departmentId.value))
const activeFilterCount = computed(() => Number(Boolean(search.value.trim())) + Number(Boolean(departmentId.value)))

const columns = computed<TableColumn<HrDocument>[]>(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('hr.docs.columns.name') },
  { accessorKey: 'department', header: t('hr.docs.columns.department') },
])

let pendingSearch: string | null = null
let pendingNavigation: RouteLocationNormalized | null = null
let lastPushed: { q: string; departmentId: number | undefined; offset: number } | null = null
let writesInFlight = 0
let lastWrite = 0
let disposed = false
function isCurrentList() { return (router.currentRoute.value.path.replace(/\/+$/, '') || '/') === '/hr/documents' }
const stopNavigationStart = useNuxtApp().hook('nasq:navigation:start', to => { pendingNavigation = to })
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
    departmentId: query.department_id ? Number(query.department_id) : undefined,
    offset: Math.max(0, Number(query.offset ?? 0) || 0),
  }
  writesInFlight++
  void router.replace({ query, hash: router.currentRoute.value.hash })
    .then(failure => { if (failure && write === lastWrite) lastPushed = null })
    .catch(() => { if (write === lastWrite) lastPushed = null })
    .finally(() => { writesInFlight--; flushSearch() })
}
function writeFilters(q: string) {
  offset.value = 0
  writeListQuery({ ...route.query, q: q || undefined, department_id: departmentId.value ?? undefined, offset: undefined })
}
function flushSearch() {
  if (disposed || pendingNavigation || writesInFlight || !isCurrentList() || pendingSearch === null) return
  const next = pendingSearch
  pendingSearch = null
  if (next === String(route.query.q ?? '').trim()) return
  writeFilters(next)
}
watch(() => [route.query.q, route.query.department_id, route.query.offset], ([q, department, nextOffset]) => {
  const next = {
    q: String(q ?? ''),
    departmentId: department ? Number(department) : undefined,
    offset: Math.max(0, Number(nextOffset ?? 0) || 0),
  }
  if (lastPushed && next.q === lastPushed.q && next.departmentId === lastPushed.departmentId && next.offset === lastPushed.offset) lastPushed = null
  else {
    pendingSearch = null
    search.value = next.q
  }
  departmentId.value = next.departmentId
  offset.value = next.offset
})
watch(debouncedSearch, value => { pendingSearch = value.trim(); flushSearch() })

function updateFilters() {
  if (!isCurrentList() || disposed) return
  writeFilters(search.value.trim())
}
function onDepartmentChange(value: unknown) {
  departmentId.value = value && value !== 'all' ? Number(value) : undefined
  updateFilters()
}
function clearSearch() {
  search.value = ''
  updateFilters()
}
function clearFilters() {
  search.value = ''
  departmentId.value = undefined
  updateFilters()
}
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || hasPendingSearch.value || next < 1 || next > pages.value) return
  if (!isCurrentList() || disposed) return
  offset.value = (next - 1) * limit
  writeListQuery({ ...route.query, q: search.value.trim() || undefined, department_id: departmentId.value ?? undefined, offset: offset.value > 0 ? offset.value : undefined })
}
const liveListQuery = computed(() => {
  const { returnTo: _referrer, ...context } = route.query
  return { ...context, q: search.value.trim() || undefined, department_id: departmentId.value ?? undefined, offset: !hasPendingSearch.value && offset.value > 0 ? offset.value : undefined }
})
const liveListPath = computed(() => router.resolve({ path: '/hr/documents', query: liveListQuery.value, hash: route.hash }).fullPath)
function documentTo(document: HrDocument) {
  return { path: `/hr/departments/${document.department.id}/documents/${document.id}`, query: returnToQuery(liveListPath.value) }
}
function openLiveDocument(event: MouseEvent, document: HrDocument) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  void router.push(documentTo(document)).catch(() => undefined)
}

// The create panel (documents/new.vue) returns to this list with the state it was showing and drops a
// referrer's returnTo, so the link carries the list state only (department_id preselects its department).
const createTo = computed(() => {
  if (!can('hr.documents.manage')) return undefined
  return { path: '/hr/documents/new', query: liveListQuery.value, ...(route.hash ? { hash: route.hash } : {}) }
})
function openLiveCreate(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  if (!hydrated.value || disposed || !isCurrentList() || !can('hr.documents.manage')) return
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
    :title="t('nav.documents')"
    :create-to="createTo"
    :create-label="t('hr.docs.new')"
    create-test-id="hr-document-new"
    @click.capture="openLiveCreate"
  >
    <template #filters>
      <div class="w-full min-w-0" data-testid="documents-toolbar">
        <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput v-model="search" :disabled="!hydrated" :placeholder="t('hr.docs.search')" :aria-label="t('hr.docs.search')" icon="i-lucide-search" class="min-w-52" @change="updateFilters" />
          </template>
          <template v-if="can('hr.departments.read')" #default>
            <SharedFilterField :label="t('hr.docs.department')" for="hr-documents-department">
              <USelect id="hr-documents-department" :model-value="departmentId ? String(departmentId) : 'all'" :items="departmentOptions" class="w-full" :disabled="!hydrated" @update:model-value="onDepartmentChange" />
            </SharedFilterField>
          </template>
          <template #active>
            <div v-if="hasActiveFilters" class="flex flex-wrap items-center gap-2">
              <SharedFilterChip v-if="search.trim()" :label="t('hr.directory.searchValue', { value: search })" @remove="clearSearch" />
              <SharedFilterChip v-if="selectedDepartment" :label="selectedDepartment.name" @remove="onDepartmentChange('all')" />
            </div>
          </template>
        </FilterBar>
      </div>
    </template>
    <SharedDataTable
      :rows="query.data.value?.items ?? []"
      :columns="columns"
      row-key="id"
      :row-to="documentTo"
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty-text="t('hr.docs.empty')"
      :caption="t('hr.docs.title')"
      :page="page"
      :pages="pages"
      @update:page="setPage"
      @retry="query.refetch"
    >
      <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
      <template #name-cell="{ row }"><NuxtLink :to="documentTo(row.original)" @click.capture="openLiveDocument($event, row.original)" class="rounded font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.name }}</NuxtLink></template>
      <template #department-cell="{ row }"><span class="text-muted">{{ row.original.department.name }}</span></template>
      <template #mobile-row="{ row }">
        <bdi class="block text-xs text-muted">#{{ row.id }}</bdi>
        <NuxtLink :to="documentTo(row)" @click.capture="openLiveDocument($event, row)" class="rounded font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.name }}</NuxtLink>
        <p class="mt-1 text-xs text-muted">{{ row.department.name }}</p>
      </template>
    </SharedDataTable>
  </SharedListPage>
  <NuxtPage />
</template>
