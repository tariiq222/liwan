<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import TaskArchivedTable from './TaskArchivedTable.vue'
import FilterBar from '@liwan/ui/app/components/shared/data/FilterBar.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const q = ref(typeof route.query.q === 'string' ? route.query.q : '')
const projectId = computed(() => {
  const value = Number(route.query.project_id)
  return Number.isInteger(value) && value > 0 ? value : undefined
})
watch(q, value => {
  if (value !== String(route.query.q ?? '')) void router.replace({ query: { ...route.query, q: value || undefined } })
})
watch(() => route.query.q, value => { q.value = typeof value === 'string' ? value : '' })
const mine = computed(() => route.query.filter === 'mine')
const params = computed(() => ({ project_id: projectId.value, mine: mine.value, q: q.value.trim() || undefined }))
const backTo = computed(() => safeReturnTo(route.query.returnTo, projectId.value ? `/projects/${projectId.value}/tasks` : '/tasks', ['/tasks', '/projects']))
const activeFilterCount = computed(() => Number(Boolean(q.value.trim())))

function clearFilters() {
  q.value = ''
}
</script>

<template>
  <SharedListPage
    :title="t('taskLifecycle.archivedTasks')"
    :back-to="backTo"
    :back-label="t('taskLifecycle.back')"
  >
    <SharedListCard>
      <template #filters>
        <div class="w-full min-w-0" data-testid="archived-tasks-toolbar">
          <FilterBar class="w-full" embedded :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
            <template #search>
              <UInput v-model="q" :disabled="!hydrated" :placeholder="t('taskLifecycle.searchArchived')" :aria-label="t('taskLifecycle.searchArchived')" icon="i-lucide-search" class="min-w-48 flex-1">
                <template v-if="q" #trailing>
                  <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('tasks.filters.clearSearch')" class="-me-1" @click="clearFilters" />
                </template>
              </UInput>
            </template>
          </FilterBar>
        </div>
      </template>
      <TaskArchivedTable :params="params" />
    </SharedListCard>
  </SharedListPage>
</template>
