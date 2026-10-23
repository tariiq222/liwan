<script setup lang="ts">
import { filterWorkRows, groupByWork, parseWorkKind, sourcesOf, WORK_KINDS, WORK_ROWS_LIMIT, workCountLabel } from '@/composables/nav/attentionModel'
import { useAttention } from '@/composables/useAttention'
import { useModuleLabel } from '@/composables/useModuleLabel'
import WorkRow from '@/components/work/WorkRow.vue'

// «مهامي»: the work the user's applications ask of them, split by what is asked (do, decide, follow), from the applications'
// own attention providers (no endpoint of its own). The kind lives in the URL (`?tab=`), so refresh and back keep it.
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { can } = useAccess()
const sourceLabel = useModuleLabel()
const hydrated = useHydrated()
const { rows, pending, failed, cappedKinds, refetch } = useAttention('all', { limit: WORK_ROWS_LIMIT })
const grouped = computed(() => groupByWork(rows.value))

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
  <SharedPageContainer width="list" data-testid="work-page">
    <SharedPageHeader :title="t('myTasks.work.title')">
      <UButton to="/my-tasks" color="neutral" variant="outline" size="sm" class="rounded-full" icon="i-lucide-list-checks" :label="t('myTasks.work.myList')" data-testid="work-my-list" />
      <UButton v-if="can('tasks.tasks.create')" to="/my-tasks/new" size="sm" class="rounded-full" icon="i-lucide-plus" :label="t('myTasks.new')" data-testid="work-new-task" />
    </SharedPageHeader>
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
  </SharedPageContainer>
</template>
