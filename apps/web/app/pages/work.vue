<script setup lang="ts">
import { filterWorkRows, groupByWork, parseWorkKind, sourcesOf, WORK_KINDS, WORK_ROWS_LIMIT, workCountLabel } from '@/composables/nav/attentionModel'
import { useAttention } from '@/composables/useAttention'
import { useModuleLabel } from '@/composables/useModuleLabel'
import WorkRow from '@/components/work/WorkRow.vue'

// «أعمالي»: one personal workspace with two tabs (owner decision 2026-11-21). «بانتظاري» is the work the user's
// applications ask of them, split by what is asked (do, decide, follow), from the applications' own attention
// providers; its kind lives in `?tab=`. «المهام» is the personal task list, which used to be /my-tasks; it lives in
// `?view=tasks` so the two query parameters never collide. /my-tasks redirects here with that tab open, and its record
// routes (/my-tasks/{id}, /new, /{id}/edit) are untouched.
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { can } = useAccess()
const sourceLabel = useModuleLabel()
const hydrated = useHydrated()
const { rows, pending, failed, cappedKinds, refetch } = useAttention('all', { limit: WORK_ROWS_LIMIT })
const grouped = computed(() => groupByWork(rows.value))

// The workspace tab: «بانتظاري» (the default) or «المهام».
const workspaceTab = computed<'attention' | 'tasks'>(() => route.query.view === 'tasks' ? 'tasks' : 'attention')
const workspaceTabs = computed(() => [
  { value: 'attention', label: t('myTasks.work.tabs.attention') },
  { value: 'tasks', label: t('myTasks.work.tabs.tasks') },
])
async function selectWorkspaceTab(value: string) {
  const { view: _view, ...rest } = route.query
  await router.push({ query: value === 'tasks' ? { ...rest, view: 'tasks' } : rest })
}

const kind = computed(() => parseWorkKind(route.query.tab))
const kindItems = computed(() => WORK_KINDS.map(value => ({
  value,
  label: `${t(`myTasks.work.kinds.${value}`)} (${workCountLabel(grouped.value[value].length, cappedKinds.value.includes(value))})`,
  testId: `work-tab-${value}`,
})))
async function selectKind(value: string) {
  const next = parseWorkKind(value)
  const { tab: _tab, ...rest } = route.query
  await router.push({ query: next === 'execute' ? rest : { ...rest, tab: next } })
}

const source = ref('all')
const search = ref('')
const sourceItems = computed(() => [
  { value: 'all', label: t('myTasks.work.allSources') },
  ...sourcesOf(rows.value).map(module => ({ value: module, label: sourceLabel(module) })),
])
// A source that no longer has rows (after a refresh of the data) falls back to all, so the list is never hidden by a stale filter.
watch(sourceItems, (items) => { if (!items.some(item => item.value === source.value)) source.value = 'all' })
const shown = computed(() => filterWorkRows(grouped.value[kind.value], { source: source.value, query: search.value }))
const activeFilters = computed(() => (source.value !== 'all' ? 1 : 0) + (search.value.trim() !== '' ? 1 : 0))
const filtering = computed(() => activeFilters.value > 0)
function clearFilters() {
  source.value = 'all'
  search.value = ''
}
</script>

<template>
  <SharedPageContainer data-testid="work-page">
    <SharedPageHeader :title="t('myTasks.work.title')">
      <UButton v-if="can('tasks.tasks.create')" to="/my-tasks/new" size="sm" icon="i-lucide-plus" :label="t('myTasks.new')" data-testid="work-new-task" />
    </SharedPageHeader>
    <SharedSegmentedControl :disabled="!hydrated" :model-value="workspaceTab" :items="workspaceTabs" :label="t('myTasks.work.tabsLabel')" data-testid="workspace-tabs" class="self-start" @update:model-value="selectWorkspaceTab" />
    <!-- «المهام» is the personal task list itself, not a copy: the list keeps its own search, scope and view in the URL. -->
    <MyTasksWorkspace v-if="workspaceTab === 'tasks'" />
    <template v-else>
    <p class="-mt-2 text-sm text-muted">{{ t('myTasks.work.description') }}</p>
    <SharedListCard>
      <template #filters>
        <div class="min-w-0 space-y-3">
          <SharedSegmentedControl :disabled="!hydrated" :model-value="kind" :items="kindItems" :label="t('myTasks.work.kindsLabel')" data-testid="work-tabs" @update:model-value="selectKind" />
          <SharedFilterBar embedded :active-count="activeFilters" @clear="clearFilters">
            <template #search>
              <UInput v-model="search" :disabled="!hydrated" type="search" icon="i-lucide-search" :placeholder="t('myTasks.work.search')" :aria-label="t('myTasks.work.search')" data-testid="work-search" />
            </template>
            <USelect v-model="source" :disabled="!hydrated" :items="sourceItems" class="min-w-40" :aria-label="t('myTasks.work.source')" data-testid="work-source" />
          </SharedFilterBar>
        </div>
      </template>
      <SharedLoadingSkeleton v-if="pending" />
      <SharedErrorState v-else-if="failed" data-testid="work-error" @retry="refetch()" />
      <SharedEmptyState v-else-if="!shown.length" compact :title="filtering ? t('myTasks.work.noMatch') : t(`myTasks.work.empty.${kind}`)" data-testid="work-empty" />
      <ul v-else class="divide-y divide-default" :aria-label="t(`myTasks.work.kinds.${kind}`)" data-testid="work-list">
        <WorkRow v-for="row in shown" :key="row.id" :row="row" :source-label="sourceLabel(row.module)" />
      </ul>
    </SharedListCard>
    </template>
  </SharedPageContainer>
</template>
