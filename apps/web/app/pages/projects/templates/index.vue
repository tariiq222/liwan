<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { LocationQueryRaw, RouteLocationNormalized } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import FilterBar from '@/components/shared/FilterBar.vue'
import type { RowAction } from '@/components/shared/RowActions.vue'
import { useProjectTemplateList } from '@/composables/useProjectTemplates'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const q = refDebounced(search, 250)
const pageSize = 50
const offset = computed(() => {
  const value = Number(route.query.offset)
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
})
let pendingSearch: string | null = null
let pendingNavigation: RouteLocationNormalized | null = null
let lastPushed: string | null = null
let writesInFlight = 0
let lastWrite = 0
let disposed = false
function isCurrentList() { return (router.currentRoute.value.path.replace(/\/+$/, '') || '/') === '/projects/templates' }
const stopNavigationStart = useNuxtApp().hook('nasq:navigation:start', to => { pendingNavigation = to })
function settleNavigation(to: RouteLocationNormalized) {
  if (to !== pendingNavigation) return
  pendingNavigation = null
  if (!writesInFlight) queueMicrotask(flushSearch)
}
const stopAfterEach = router.afterEach(to => settleNavigation(to))
const stopOnError = router.onError((_error, to) => settleNavigation(to))
onScopeDispose(() => { disposed = true; stopNavigationStart(); stopAfterEach(); stopOnError() })
function writeListQuery(query: LocationQueryRaw, replace = true) {
  if (!isCurrentList() || disposed) return
  const write = ++lastWrite
  lastPushed = typeof query.q === 'string' ? query.q : ''
  writesInFlight++
  const target = { query, hash: router.currentRoute.value.hash }
  void (replace ? router.replace(target) : router.push(target))
    .then(failure => { if (failure && write === lastWrite) lastPushed = null })
    .catch(() => { if (write === lastWrite) lastPushed = null })
    .finally(() => { writesInFlight--; flushSearch() })
}
function flushSearch() {
  if (disposed || pendingNavigation || writesInFlight || !isCurrentList() || pendingSearch === null) return
  const next = pendingSearch
  pendingSearch = null
  if (next === (route.query.q ?? '')) return
  writeListQuery({ ...router.currentRoute.value.query, q: next || undefined, offset: undefined })
}
watch(q, value => { pendingSearch = value.trim(); flushSearch() })
watch(() => route.query.q, value => {
  const next = typeof value === 'string' ? value : ''
  if (next === lastPushed) { lastPushed = null; return }
  pendingSearch = null
  search.value = next
})
const list = useProjectTemplateList(computed(() => ({ q: typeof route.query.q === 'string' ? route.query.q : '', limit: pageSize, offset: offset.value })))
const total = computed(() => list.data.value?.total ?? 0)
function goPage(next: number) { writeListQuery({ ...route.query, q: search.value.trim() || undefined, offset: next || undefined }, false) }
const items = computed(() => list.data.value?.items ?? [])
const canManage = computed(() => list.data.value?.can_manage ?? false)
const canApply = computed(() => list.data.value?.can_apply ?? false)
const activeFilterCount = computed(() => Number(Boolean(search.value.trim())))
function clearFilters() {
  search.value = ''
}
// The list URL as it will be once the debounced search lands: every row link carries it.
const liveQuery = computed(() => ({ ...(search.value.trim() ? { q: search.value.trim() } : {}), ...(offset.value ? { offset: String(offset.value) } : {}) }))
const itemTo = (item: { id: number }) => ({ path: `/projects/templates/${item.id}`, query: liveQuery.value })
const createTo = computed(() => canManage.value ? { path: '/projects/templates/new', query: liveQuery.value } : undefined)
const columns = computed<TableColumn<(typeof items.value)[number]>[]>(() => [
  { id: 'number', header: t('app.recordNumber') },
  { id: 'name', header: t('projects.templates.fields.name') },
  { id: 'description', header: t('projects.templates.fields.description') },
  { id: 'summary', header: t('projects.templates.columns.content') },
  { id: 'apply', header: t('projects.templates.columns.availability') },
  { id: 'actions', header: t('app.actions') },
])
// One quiet "View" action on its own; apply and edit join it in the shared "more" menu.
function rowActions(item: (typeof items.value)[number]): RowAction[] {
  const actions: RowAction[] = [{ label: t('projects.menu.open'), icon: 'i-lucide-eye', to: itemTo(item) }]
  if (item.can_apply && canApply.value) actions.push({ label: t('projects.templates.actions.apply'), icon: 'i-lucide-play', to: { path: `/projects/templates/${item.id}/apply`, query: liveQuery.value } })
  if (canManage.value) actions.push({ label: t('projects.templates.actions.edit'), icon: 'i-lucide-pencil', to: { path: `/projects/templates/${item.id}/edit`, query: liveQuery.value } })
  return actions
}
const PAGE = pageSize
const pageNumber = computed(() => Math.floor(offset.value / PAGE) + 1)
const pages = computed(() => Math.max(1, pageNumber.value, Math.ceil(total.value / PAGE)))
function openLiveItem(event: MouseEvent, item: { id: number }) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  void router.push(itemTo(item)).catch(() => undefined)
}
</script>

<template>
  <SharedListPage
    :title="t('projects.templates.title')"
    :description="t('projects.templates.description')"
    :create-to="createTo"
    :create-label="t('projects.templates.actions.new')"
  >
    <template #filters>
      <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
        <template #search>
          <UInput v-model="search" name="template-search" :aria-label="t('projects.templates.filters.search')" icon="i-lucide-search" :disabled="!hydrated" :placeholder="t('projects.templates.filters.search')" class="w-full min-w-52" />
        </template>
        <template #active>
          <div v-if="search.trim()" class="flex flex-wrap items-center gap-2">
            <SharedFilterChip :label="`${t('projects.templates.filters.search')}: ${search}`" @remove="clearFilters" />
          </div>
        </template>
      </FilterBar>
    </template>
    <SharedDataTable
      :rows="items"
      :columns="columns"
      row-key="id"
      :row-to="itemTo"
      :loading="list.isLoading.value"
      :error="list.error.value"
      :empty-text="t('projects.templates.empty')"
      :page="pageNumber"
      :pages="pages"
      :caption="t('projects.templates.title')"
      @update:page="goPage((($event as number) - 1) * PAGE)"
      @retry="list.refetch"
    >
      <template #number-cell="{ row }"><SharedRecordNumber :value="row.original.id" /></template>
      <template #name-cell="{ row }">
        <NuxtLink :to="itemTo(row.original)" @click.capture="openLiveItem($event, row.original)" class="font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.name }}</NuxtLink>
      </template>
      <template #description-cell="{ row }">{{ row.original.description || '—' }}</template>
      <template #summary-cell="{ row }">{{ t('projects.templates.summary', { stages: t('projects.templates.summaryStages', { count: row.original.definition.stages.length }, row.original.definition.stages.length), tasks: t('projects.templates.summaryTasks', { count: row.original.definition.tasks.length }, row.original.definition.tasks.length), milestones: t('projects.templates.summaryMilestones', { count: row.original.definition.milestones.length }, row.original.definition.milestones.length) }) }}</template>
      <template #apply-cell="{ row }"><SharedStatusBadge v-if="row.original.can_apply && canApply" tone="success" :label="t('projects.templates.canApply')" /><span v-else class="text-muted">—</span></template>
      <template #actions-cell="{ row }">
        <SharedRowActions :actions="rowActions(row.original)" :label="t('projects.templates.actionsNamed', { name: row.original.name })" @click.stop />
      </template>
      <template #mobile-row="{ row: item }">
        <div class="space-y-1">
          <div class="flex items-start justify-between gap-3">
            <NuxtLink :to="itemTo(item)" @click.capture="openLiveItem($event, item)" class="font-medium text-highlighted hover:underline">{{ item.name }}</NuxtLink>
            <SharedStatusBadge v-if="item.can_apply && canApply" tone="success" :label="t('projects.templates.canApply')" />
          </div>
          <p class="text-sm text-muted">{{ item.description }}</p>
          <p class="text-xs text-muted">{{ t('projects.templates.summary', { stages: t('projects.templates.summaryStages', { count: item.definition.stages.length }, item.definition.stages.length), tasks: t('projects.templates.summaryTasks', { count: item.definition.tasks.length }, item.definition.tasks.length), milestones: t('projects.templates.summaryMilestones', { count: item.definition.milestones.length }, item.definition.milestones.length) }) }}</p>
          <div class="flex justify-end"><SharedRowActions :actions="rowActions(item)" :label="t('projects.templates.actionsNamed', { name: item.name })" /></div>
        </div>
      </template>
    </SharedDataTable>
  </SharedListPage>
</template>
