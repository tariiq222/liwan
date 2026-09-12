<script setup lang="ts">
import ProjectStatusBadge from '@/components/project/ProjectStatusBadge.vue'
import { formatNullablePercent } from '@/utils/projectFinance'
import type { DashboardProject } from '@/utils/projectChartData'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import { formatNasqDateTime } from '@/composables/calendarDate'

const props = defineProps<{ rows: readonly DashboardProject[] }>()
const { t, locale } = useI18n()
const route = useRoute()
const { entryTo } = useProjectWorkspaceMemory()
const compactRecords = ref(false)
const rows = computed(() => props.rows.slice(0, 5))

const projectListQuery = computed(() => ({
  q: typeof route.query.q === 'string' && route.query.q.trim() ? route.query.q : undefined,
  status: typeof route.query.status === 'string' ? route.query.status : undefined,
}))
const columns = computed(() => [
  { id: 'record', header: t('app.recordNumber') },
  { id: 'project', header: t('projects.dashboard.recentProject') },
  { id: 'status', header: t('projects.dashboard.recentStatus') },
  { id: 'progress', header: t('projects.dashboard.recentProgress') },
  { id: 'updated', header: t('projects.dashboard.recentUpdated') },
])

onMounted(() => {
  const query = window.matchMedia('(max-width: 767px)')
  const sync = () => { compactRecords.value = query.matches }
  sync()
  query.addEventListener('change', sync)
  onUnmounted(() => query.removeEventListener('change', sync))
})

function updatedAt(value: string | null | undefined) {
  if (!value) return t('projects.dashboard.unknown')
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? t('projects.dashboard.unknown') : formatNasqDateTime(date, locale.value)
}
</script>

<template>
  <UCard aria-labelledby="project-dashboard-recent-title" class="min-w-0" :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 id="project-dashboard-recent-title" class="text-lg font-semibold text-highlighted">{{ t('projects.dashboard.recentTitle') }}</h2>
          <p class="mt-1 text-sm text-muted">{{ t('projects.dashboard.recentDescription') }}</p>
        </div>
        <UButton color="neutral" variant="outline" :to="{ path: '/projects', query: projectListQuery }" :label="t('projects.dashboard.allProjects')" class="shrink-0" />
      </div>
    </template>
    <UTable
      v-if="!compactRecords"
      :data="[...rows]"
      :columns="columns"
      :caption="t('projects.dashboard.recentTitle')"
      :empty="t('projects.dashboard.noRecentProjects')"
      :ui="{ caption: 'sr-only', thead: 'nasq-ui-table-head' }"
    >
      <template #record-cell="{ row }">
        <RecordNumber :value="row.original.project.id" />
      </template>
      <template #project-cell="{ row }">
        <div data-testid="recent-project-row">
          <UButton color="neutral" variant="link" class="p-0 font-medium text-start" :to="entryTo(row.original.project.id, route.fullPath)">{{ row.original.project.name }}</UButton>
        </div>
      </template>
      <template #status-cell="{ row }"><ProjectStatusBadge :status="row.original.project.status" /></template>
      <template #progress-cell="{ row }"><span dir="ltr" class="tabular-nums">{{ formatNullablePercent(row.original.progress, t('projects.dashboard.unavailable')) }}</span></template>
      <template #updated-cell="{ row }">
        <time v-if="row.original.updated_at" :datetime="row.original.updated_at" dir="ltr" class="text-sm text-muted">{{ updatedAt(row.original.updated_at) }}</time>
        <span v-else class="text-sm text-muted">{{ updatedAt(row.original.updated_at) }}</span>
      </template>
    </UTable>
    <ul v-else class="grid divide-y divide-default" :aria-label="t('projects.dashboard.recentTitle')">
      <li v-if="rows.length === 0" class="p-8 text-center text-sm text-muted">{{ t('projects.dashboard.noRecentProjects') }}</li>
      <li v-for="row in rows" :key="row.project.id" class="grid gap-3 p-4" data-testid="recent-project-row">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <RecordNumber :value="row.project.id" />
            <UButton color="neutral" variant="link" class="mt-1 block p-0 text-start font-medium whitespace-normal" :to="entryTo(row.project.id, route.fullPath)">{{ row.project.name }}</UButton>
          </div>
          <ProjectStatusBadge :status="row.project.status" />
        </div>
        <dl class="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt class="text-muted">{{ t('projects.dashboard.recentProgress') }}</dt>
            <dd dir="ltr" class="tabular-nums">{{ formatNullablePercent(row.progress, t('projects.dashboard.unavailable')) }}</dd>
          </div>
          <div>
            <dt class="text-muted">{{ t('projects.dashboard.recentUpdated') }}</dt>
            <dd>
              <time v-if="row.updated_at" :datetime="row.updated_at" dir="ltr">{{ updatedAt(row.updated_at) }}</time>
              <span v-else>{{ updatedAt(row.updated_at) }}</span>
            </dd>
          </div>
        </dl>
      </li>
    </ul>
  </UCard>
</template>
