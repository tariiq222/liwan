<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import FilterBar from '@/components/shared/FilterBar.vue'
import MyTaskRow from '@/components/my-tasks/MyTaskRow.vue'
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
  void router.replace({ query: listPatch(route.query, patch) })
}

// The last search this page wrote to the URL. Its navigation lands later than the keystrokes typed
// meanwhile, so a landing of that very value must not overwrite the input: only an external change
// (back/forward, a link) differs from both the input and `lastPushed` and is copied into the input.
let lastPushed: string | null = null
watch(() => state.value.q, value => {
  if (value === lastPushed) {
    lastPushed = null
    return
  }
  if (value !== search.value.trim()) search.value = value
})
watch(debouncedSearch, value => {
  const next = value.trim()
  if (next === state.value.q) return
  lastPushed = next
  update({ q: next })
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
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('myTasks.title')">
      <template v-if="can('tasks.tasks.create')" #actions>
        <UButton to="/my-tasks/new" icon="i-lucide-plus" data-testid="my-tasks-new">{{ t('myTasks.new') }}</UButton>
      </template>
    </SharedPageHeader>

    <UTabs
      :model-value="state.tab"
      :items="tabItems"
      :content="false"
      variant="link"
      :ui="sectionTabsUi"
      :aria-label="t('myTasks.title')"
      data-testid="my-tasks-tabs"
      @update:model-value="update({ tab: $event as MyTaskListState['tab'] })"
    />

    <div class="w-full min-w-0" data-testid="my-tasks-toolbar">
      <FilterBar inline class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
        <template #search>
          <UInput
            v-model="search"
            :disabled="!hydrated"
            :placeholder="t('myTasks.list.search')"
            :aria-label="t('myTasks.list.search')"
            icon="i-lucide-search"
            class="w-full"
          />
        </template>
        <SharedFilterChoice
          :label="t('myTasks.list.scope')"
          :items="scopeItems"
          :model-value="state.scope"
          layout="segment"
          :disabled="!hydrated"
          @update:model-value="update({ scope: $event as MyTaskListState['scope'] })"
        />
        <SharedFilterField :label="t('myTasks.list.sort.label')" for="my-tasks-sort">
          <USelect
            id="my-tasks-sort"
            :model-value="state.sort"
            :items="sortItems"
            class="w-full"
            :disabled="!hydrated"
            @update:model-value="update({ sort: $event as MyTaskListState['sort'] })"
          />
        </SharedFilterField>
        <template #actions>
          <UBadge v-if="query.data.value" color="neutral" variant="subtle" data-testid="my-tasks-total">{{ t('myTasks.list.total', { count: total }) }}</UBadge>
        </template>
      </FilterBar>
    </div>

    <SharedPageState
      :loading="query.isLoading.value"
      :error="items.length ? null : query.error.value"
      :empty="!query.isLoading.value && !items.length"
      :empty-text="emptyText"
      @retry="query.refetch()"
    >
      <UAlert
        v-if="inlineError"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="t('myTasks.list.loadError')"
        class="mb-3"
      >
        <template #actions>
          <UButton color="neutral" variant="outline" type="button" :disabled="!hydrated" @click="retryInline">{{ t('app.retry') }}</UButton>
        </template>
      </UAlert>
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <ul class="divide-y divide-default">
          <MyTaskRow v-for="task in items" :key="task.id" :task="task" :return-to="route.fullPath" :today="today" />
        </ul>
        <div v-if="query.hasNextPage.value" class="border-t border-default p-3 text-center">
          <UButton
            color="neutral"
            variant="outline"
            type="button"
            :loading="query.isFetchingNextPage.value"
            :disabled="query.isFetchingNextPage.value || !hydrated"
            @click="query.fetchNextPage()"
          >
            {{ t('myTasks.list.loadMore') }}
          </UButton>
        </div>
      </UCard>
    </SharedPageState>
  </SharedPageContainer>
</template>
