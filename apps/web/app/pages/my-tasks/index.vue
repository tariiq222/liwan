<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationNormalized } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import FilterBar from '@/components/shared/data/FilterBar.vue'
import MyTaskRow from '@/components/personal-tasks/MyTaskRow.vue'
import { sectionTabsUi } from '@/utils/sectionTabs'
import { useMyTaskPages } from '@/composables/useMyTaskPages'
import {
  dedupeById,
  listPatch,
  localToday,
  MY_TASK_SCOPES,
  MY_TASK_SORTS,
  MY_TASK_TABS,
  parseListState,
  toListParams,
  type MyTaskListState,
} from '@/utils/myTaskList'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

// The URL is the single source of truth for tab, scope, sort and search.
const state = computed(() => parseListState(route.query))
const search = ref(state.value.q)
const debouncedSearch = refDebounced(search, 250)

const query = useMyTaskPages(computed(() => toListParams(state.value)))
const items = computed(() => dedupeById((query.data.value?.pages ?? []).flatMap(page => page.items)))
// The last loaded page carries the freshest total. It can exceed the rows shown: the server may drop
// rows the caller cannot read while still counting them.
const total = computed(() => query.data.value?.pages.at(-1)?.total ?? 0)

// The local date is unknown on the server and can differ from the browser's: it is read after mount (so
// hydration matches, with no overdue styling during SSR) and again when the tab becomes visible.
const today = ref<string | null>(null)
function refreshToday() { today.value = localToday() }
onMounted(() => {
  refreshToday()
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))
function onVisible() { if (document.visibilityState === 'visible') refreshToday() }

// A failed next page or background refetch must not hide the rows already loaded.
const inlineError = computed(() => items.value.length > 0 && (query.isFetchNextPageError.value || query.isRefetchError.value))
function retryInline() {
  if (query.isFetchNextPageError.value) void query.fetchNextPage()
  else void query.refetch()
}

function update(patch: Partial<MyTaskListState>) {
  if (!isCurrentList() || disposed) return
  const next = { q: search.value.trim(), ...patch }
  const write = ++lastWrite
  lastPushed = next.q
  writesInFlight++
  void router.replace({ query: listPatch(route.query, next), hash: router.currentRoute.value.hash })
    .then(failure => { if (failure && write === lastWrite) lastPushed = null })
    .catch(() => { if (write === lastWrite) lastPushed = null })
    .finally(() => { writesInFlight--; flushSearch() })
}

// The last search this page wrote to the URL. Its navigation lands later than the keystrokes typed
// meanwhile, so a landing of that very value must not overwrite the input: only an external change
// (back/forward, a link) differs from both the input and `lastPushed` and is copied into the input.
let lastPushed: string | null = null
let pendingSearch: string | null = null
let pendingNavigation: RouteLocationNormalized | null = null
let writesInFlight = 0
let lastWrite = 0
let disposed = false
function isCurrentList() { return (router.currentRoute.value.path.replace(/\/+$/, '') || '/') === '/my-tasks' }
const stopNavigationStart = useNuxtApp().hook('nasq:navigation:start', to => { pendingNavigation = to })
function settleNavigation(to: RouteLocationNormalized) {
  if (to !== pendingNavigation) return
  pendingNavigation = null
  // Let the route watcher apply an external search before deciding whether a paused write remains.
  if (!writesInFlight) queueMicrotask(flushSearch)
}
const stopAfterEach = router.afterEach(to => settleNavigation(to))
const stopOnError = router.onError((_error, to) => settleNavigation(to))
onScopeDispose(() => { disposed = true; stopNavigationStart(); stopAfterEach(); stopOnError() })
function flushSearch() {
  if (disposed || pendingNavigation || writesInFlight || !isCurrentList() || pendingSearch === null) return
  const next = pendingSearch
  pendingSearch = null
  if (next === state.value.q) return
  update({ q: next })
}
watch(() => state.value.q, value => {
  if (value === lastPushed) {
    lastPushed = null
    return
  }
  pendingSearch = null
  if (value !== search.value.trim()) search.value = value
})
watch(debouncedSearch, value => {
  const next = value.trim()
  pendingSearch = next
  flushSearch()
})

const tabItems = computed(() => MY_TASK_TABS.map(value => ({
  label: t(`myTasks.list.tabs.${value}`),
  value,
  disabled: !hydrated.value,
})))
const scopeItems = computed(() => MY_TASK_SCOPES.map(value => ({ value, label: t(`myTasks.list.filters.${value}`) })))
const sortItems = computed(() => MY_TASK_SORTS.map(value => ({ value, label: t(`myTasks.list.sort.${value}`) })))

const activeFilterCount = computed(() => Number(Boolean(state.value.q)) + Number(state.value.scope !== 'all'))
const emptyText = computed(() => state.value.q
  ? t('myTasks.list.empty.search')
  : t(`myTasks.list.empty.${state.value.tab}`))

function clearFilters() {
  search.value = ''
  update({ q: '', scope: 'all' })
}
// The list URL as it will be once the debounced search lands: every row carries it as its `returnTo`.
const liveListPath = computed(() => router.resolve({ path: '/my-tasks', query: listPatch(route.query, { q: search.value.trim() }), hash: route.hash }).fullPath)
const rowTo = (task: (typeof items.value)[number]) => ({
  path: task.source === 'project' ? task.href : `/my-tasks/${task.id}`,
  query: { returnTo: liveListPath.value },
})
const columns = computed<TableColumn<(typeof items.value)[number]>[]>(() => [
  { id: 'name', header: t('tasks.columns.title') },
  { id: 'state', header: t('tasks.columns.state') },
  { id: 'deadline', header: t('tasks.columns.deadline') },
  { id: 'assignees', header: t('tasks.columns.assignees') },
])
const createTo = computed(() => can('tasks.tasks.create') ? { path: '/my-tasks/new', query: { returnTo: liveListPath.value } } : undefined)
function openLiveTask(_event: MouseEvent, task: (typeof items.value)[number]) { void router.push(rowTo(task)).catch(() => undefined) }
</script>

<template>
  <SharedListPage
    :title="t('myTasks.title')"
    :create-to="createTo"
    :create-label="t('myTasks.new')"
    create-test-id="my-tasks-new"
  >
    <template #filters>
      <div class="space-y-3">
        <UTabs :model-value="state.tab" :items="tabItems" :content="false" variant="link" :ui="sectionTabsUi" :aria-label="t('myTasks.title')" data-testid="my-tasks-tabs" @update:model-value="update({ tab: $event as MyTaskListState['tab'] })" />
        <div class="w-full min-w-0" data-testid="my-tasks-toolbar">
          <FilterBar inline class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
            <template #search>
              <UInput v-model="search" :disabled="!hydrated" :placeholder="t('myTasks.list.search')" :aria-label="t('myTasks.list.search')" icon="i-lucide-search" class="w-full" />
            </template>
            <SharedFilterChoice :label="t('myTasks.list.scope')" :items="scopeItems" :model-value="state.scope" layout="segment" :disabled="!hydrated" @update:model-value="update({ scope: $event as MyTaskListState['scope'] })" />
            <SharedFilterField :label="t('myTasks.list.sort.label')" for="my-tasks-sort">
              <USelect id="my-tasks-sort" :model-value="state.sort" :items="sortItems" class="w-full" :disabled="!hydrated" @update:model-value="update({ sort: $event as MyTaskListState['sort'] })" />
            </SharedFilterField>
            <template #actions>
              <UBadge v-if="query.data.value" color="neutral" variant="subtle" data-testid="my-tasks-total">{{ t('myTasks.list.total', { count: total }, total) }}</UBadge>
            </template>
          </FilterBar>
        </div>
      </div>
    </template>

    <UAlert v-if="inlineError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('myTasks.list.loadError')">
      <template #actions>
        <UButton color="neutral" variant="outline" type="button" :disabled="!hydrated" @click="retryInline">{{ t('app.retry') }}</UButton>
      </template>
    </UAlert>
    <SharedDataTable
      :rows="items"
      :columns="columns"
       :row-key="task => `${task.source}:${task.id}`"
      :row-to="rowTo"
      :loading="query.isLoading.value"
      :error="items.length ? null : query.error.value"
      :empty-text="emptyText"
      :caption="t('myTasks.title')"
      @retry="query.refetch()"
    >
      <template #name-cell="{ row }"><MyTaskRow :task="row.original" :to="rowTo(row.original)" :today="today" part="name" @open="openLiveTask" /></template>
      <template #state-cell="{ row }"><MyTaskRow :task="row.original" :to="rowTo(row.original)" :today="today" part="state" /></template>
      <template #deadline-cell="{ row }"><MyTaskRow :task="row.original" :to="rowTo(row.original)" :today="today" part="deadline" /></template>
      <template #assignees-cell="{ row }"><MyTaskRow :task="row.original" :to="rowTo(row.original)" :today="today" part="assignees" /></template>
      <template #mobile-row="{ row: task }"><MyTaskRow :task="task" :to="rowTo(task)" :today="today" part="card" @open="openLiveTask" /></template>
    </SharedDataTable>
    <div v-if="query.hasNextPage.value" class="text-center">
      <UButton color="neutral" variant="outline" type="button" :loading="query.isFetchingNextPage.value" :disabled="query.isFetchingNextPage.value || !hydrated" @click="query.fetchNextPage()">{{ t('myTasks.list.loadMore') }}</UButton>
    </div>
  </SharedListPage>
</template>
