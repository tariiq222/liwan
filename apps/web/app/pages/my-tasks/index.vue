<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationNormalized } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import MyTaskRow from '@/components/personal-tasks/MyTaskRow.vue'
import type { MyTaskListPage } from '@webvue/contracts'
import { useMyTaskList } from '@/composables/useMyTaskList'
import { errorStateKind } from '@webvue/ui/app/utils/errorState'
import { currentListView, listViewQuery } from '@webvue/ui/app/utils/listView'
import { useRowNavigation } from '@webvue/ui/app/composables/useRowNavigation'
import {
  listPatch,
  localToday,
  MY_TASK_SCOPES,
  MY_TASK_SORTS,
  MY_TASK_TABS,
  MY_TASK_PAGE_SIZE,
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

const query = useMyTaskList(computed(() => toListParams(state.value)))
const lastPage = shallowRef<MyTaskListPage | null>(null)
watch(query.data, value => { if (value) lastPage.value = value }, { immediate: true })
const restricted = computed(() => ['forbidden', 'notFound'].includes(errorStateKind(query.error.value)))
const displayed = computed(() => restricted.value ? null : query.data.value ?? (query.error.value ? lastPage.value : null))
const items = computed(() => displayed.value?.items ?? [])
const total = computed(() => displayed.value?.total ?? 0)
// The list's total as a tag in the heading, once the first page has arrived.
const countTags = computed(() => displayed.value ? [{ label: t('myTasks.list.countTag', { count: total.value }, total.value) }] : [])
const page = computed(() => Math.floor(state.value.offset / MY_TASK_PAGE_SIZE) + 1)
const pages = computed(() => Math.ceil(total.value / MY_TASK_PAGE_SIZE))
watch([query.data, query.isFetching], ([data, fetching]) => {
  if (!data || fetching) return
  const last = Math.max(0, Math.ceil(data.total / MY_TASK_PAGE_SIZE) - 1) * MY_TASK_PAGE_SIZE
  if (state.value.offset > last) update({ offset: last })
})

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
const inlineError = computed(() => items.value.length > 0 && !!query.error.value)
function retryInline() { void query.refetch() }

function update(patch: Partial<MyTaskListState>, nextView?: string) {
  if (!isCurrentList() || disposed) return
  const next = { q: search.value.trim(), ...patch }
  const write = ++lastWrite
  lastPushed = next.q
  writesInFlight++
  void router.replace({ query: listPatch(nextView ? listViewQuery(route.query, nextView, views.value) : route.query, next), hash: router.currentRoute.value.hash })
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
const stopNavigationStart = useNuxtApp().hook('webvue:navigation:start', to => { pendingNavigation = to })
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

const tabItems = computed(() => MY_TASK_TABS.map(value => ({ value, label: t(`myTasks.list.tabs.${value}`) })))
const scopeItems = computed(() => MY_TASK_SCOPES.map(value => ({ value, label: t(`myTasks.list.filters.${value}`) })))
const sortItems = computed(() => MY_TASK_SORTS.map(value => ({ value, label: t(`myTasks.list.sort.${value}`) })))

const activeFilterCount = computed(() => Number(Boolean(state.value.q)) + Number(state.value.scope !== 'all'))
const emptyText = computed(() => state.value.q ? t('myTasks.list.empty.search')
  : total.value > 0 ? t('myTasks.list.empty.page')
  : state.value.scope !== 'all' ? t('myTasks.list.empty.scope') : t(`myTasks.list.empty.${state.value.tab}`))

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
const views = computed(() => [
  { value: 'table', label: t('myTasks.list.tableView'), icon: 'i-lucide-list', testId: 'my-tasks-view-table' },
  { value: 'cards', label: t('myTasks.list.cardView'), icon: 'i-lucide-layout-grid', testId: 'my-tasks-view-cards' },
])
const view = computed(() => currentListView(route.query.view, views.value))
const cardList = ref<HTMLElement | null>(null)
useRowNavigation(cardList)
function setView(value: string) {
  if (value === view.value) return
  update({}, value)
}
const columns = computed<TableColumn<(typeof items.value)[number]>[]>(() => [
  { id: 'name', header: t('tasks.columns.title'), meta: { class: { th: 'w-1/2 min-w-64', td: 'py-3' } } },
  { id: 'state', header: t('tasks.columns.state'), meta: { class: { th: 'w-28', td: 'py-3' } } },
  { id: 'deadline', header: t('tasks.columns.deadline'), meta: { class: { th: 'w-44', td: 'py-3' } } },
  { id: 'assignees', header: t('tasks.columns.assignees'), meta: { class: { th: 'w-40', td: 'py-3' } } },
])
const createTo = computed(() => can('tasks.tasks.create') ? { path: '/my-tasks/new', query: { returnTo: liveListPath.value } } : undefined)
const showEmptyAction = computed(() => !!(state.value.q || state.value.scope !== 'all' || (state.value.tab === 'open' && createTo.value)))
function openLiveTask(_event: MouseEvent, task: (typeof items.value)[number]) { void router.push(rowTo(task)).catch(() => undefined) }
</script>

<template>
  <SharedListPage
    :title="t('myTasks.title')"
    :tags="countTags"
    :description="t('myTasks.description')"
    :create-to="createTo"
    :create-label="t('myTasks.new')"
    create-test-id="my-tasks-new"
  >
    <UAlert v-if="inlineError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('myTasks.list.loadError')">
      <template #actions>
        <UButton color="neutral" variant="outline" type="button" :disabled="!hydrated" @click="retryInline">{{ t('app.retry') }}</UButton>
      </template>
    </UAlert>
    <SharedListCard>
      <template #filters>
        <div class="space-y-3">
          <div class="w-full min-w-0" data-testid="my-tasks-toolbar">
            <FilterBar class="w-full" embedded default-open :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
              <template #search>
                <UInput v-model="search" :disabled="!hydrated" :placeholder="t('myTasks.list.search')" :aria-label="t('myTasks.list.search')" icon="i-lucide-search" class="w-full" />
              </template>
              <SharedSegmentedControl :label="t('myTasks.list.scope')" :items="scopeItems" :model-value="state.scope" @update:model-value="update({ scope: $event as MyTaskListState['scope'] })" />
              <USelect id="my-tasks-sort" :model-value="state.sort" :items="sortItems" class="w-full md:w-44" :aria-label="t('myTasks.list.sort.label')" :disabled="!hydrated" @update:model-value="update({ sort: $event as MyTaskListState['sort'] })" />
              <template #view>
                <SharedSegmentedControl data-testid="my-tasks-tabs" :label="t('myTasks.title')" :items="tabItems" :model-value="state.tab" @update:model-value="update({ tab: $event as MyTaskListState['tab'] })" />
                <SharedViewSwitch :model-value="view" :options="views" @update:model-value="setView" />
              </template>
            </FilterBar>
          </div>
          <p v-if="state.tab === 'closed'" class="text-sm text-muted">{{ t('myTasks.list.closedHint') }}</p>
        </div>
      </template>

      <SharedDataTable
        v-if="view === 'table'"
        bare
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
        <template v-if="showEmptyAction" #emptyAction>
          <UButton v-if="state.q || state.scope !== 'all'" type="button" color="neutral" variant="outline" :label="t('filterCard.clear')" :disabled="!hydrated" @click="clearFilters" />
          <UButton v-else :to="createTo" icon="i-lucide-plus" :label="t('myTasks.new')" />
        </template>
        <template #name-cell="{ row }"><MyTaskRow :task="row.original" :to="rowTo(row.original)" :today="today" part="name" @open="openLiveTask" /></template>
        <template #state-cell="{ row }"><MyTaskRow :task="row.original" :to="rowTo(row.original)" :today="today" part="state" /></template>
        <template #deadline-cell="{ row }"><MyTaskRow :task="row.original" :to="rowTo(row.original)" :today="today" part="deadline" /></template>
        <template #assignees-cell="{ row }"><MyTaskRow :task="row.original" :to="rowTo(row.original)" :today="today" part="assignees" /></template>
      </SharedDataTable>
      <SharedPageState v-else :loading="query.isLoading.value" :error="query.error.value" :keep-content="items.length > 0" :empty="!items.length" :empty-text="emptyText" @retry="query.refetch()">
        <template v-if="showEmptyAction" #emptyAction>
          <UButton v-if="state.q || state.scope !== 'all'" type="button" color="neutral" variant="outline" :label="t('filterCard.clear')" :disabled="!hydrated" @click="clearFilters" />
          <UButton v-else :to="createTo" icon="i-lucide-plus" :label="t('myTasks.new')" />
        </template>
        <ul ref="cardList" class="grid min-w-0 gap-4 p-(--webvue-card-pad-dense) sm:grid-cols-2 xl:grid-cols-3" :aria-label="t('myTasks.title')" data-testid="my-tasks-cards">
          <SharedSubCard v-for="(task, index) in items" :key="`${task.source}:${task.id}`" as="li" data-shortcut-row :data-row-index="index" tabindex="-1" class="outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <MyTaskRow :task="task" :to="rowTo(task)" :today="today" part="card" @open="openLiveTask" />
          </SharedSubCard>
        </ul>
      </SharedPageState>

      <template v-if="displayed" #footer>
        <SharedListFooter :count-label="t('myTasks.list.total', { count: total }, total)" count-test-id="my-tasks-total" :page="page" :pages="pages" :disabled="query.isFetching.value" @update:page="update({ offset: ($event - 1) * MY_TASK_PAGE_SIZE })" />
      </template>
    </SharedListCard>
  </SharedListPage>
</template>
