<script setup lang="ts">
import ProjectStatusBadge from '@/components/project/ProjectStatusBadge.vue'
import { formatNullablePercent } from '@/utils/projectFinance'
import { returnToQuery } from '@/utils/safeReturnTo'
import type { DashboardProject } from '@/utils/projectChartData'
import RecordNumber from '@/components/shared/RecordNumber.vue'

const props = defineProps<{ rows: readonly DashboardProject[] }>()
const { t, locale } = useI18n()
const route = useRoute()
const rows = computed(() => props.rows.slice(0, 5))
const dateFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }))
const projectListQuery = computed(() => ({
  q: typeof route.query.q === 'string' && route.query.q.trim() ? route.query.q : undefined,
  status: typeof route.query.status === 'string' ? route.query.status : undefined,
}))

function updatedAt(value: string | null | undefined) {
  if (!value) return t('projects.dashboard.unknown')
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? t('projects.dashboard.unknown') : dateFormatter.value.format(date)
}
</script>

<template>
  <section aria-labelledby="project-dashboard-recent-title" class="nasq-panel min-w-0 overflow-hidden">
    <header class="nasq-panel-header items-start">
      <div class="min-w-0">
        <h2 id="project-dashboard-recent-title" class="text-base font-semibold leading-6">{{ t('projects.dashboard.recentTitle') }}</h2>
        <p class="mt-1 text-sm leading-6 text-muted-foreground">{{ t('projects.dashboard.recentDescription') }}</p>
      </div>
      <NuxtLink :to="{ path: '/projects', query: projectListQuery }" class="shrink-0 text-sm font-medium text-brand-link underline-offset-4 hover:underline">{{ t('projects.dashboard.allProjects') }}</NuxtLink>
    </header>
    <div class="overflow-x-auto">
      <Table class="min-w-[680px]">
        <TableHeader>
          <TableRow>
            <TableHead class="w-28 text-start">{{ t('app.recordNumber') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.dashboard.recentProject') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.dashboard.recentStatus') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.dashboard.recentProgress') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.dashboard.recentUpdated') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-if="rows.length === 0">
            <TableCell colspan="5" class="py-8 text-center text-sm text-muted-foreground">{{ t('projects.dashboard.noRecentProjects') }}</TableCell>
          </TableRow>
          <TableRow v-for="row in rows" :key="row.project.id" data-testid="recent-project-row">
            <TableCell><RecordNumber :value="row.project.id" /></TableCell>
            <TableCell>
              <NuxtLink :to="{ path: `/projects/${row.project.id}`, query: returnToQuery(route.fullPath) }" class="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{{ row.project.name }}</NuxtLink>
            </TableCell>
            <TableCell><ProjectStatusBadge :status="row.project.status" /></TableCell>
            <TableCell><span dir="ltr" class="tabular-nums">{{ formatNullablePercent(row.progress, t('projects.dashboard.unavailable')) }}</span></TableCell>
            <TableCell><time v-if="row.updated_at" :datetime="row.updated_at" dir="ltr" class="text-sm text-muted-foreground">{{ updatedAt(row.updated_at) }}</time><span v-else class="text-sm text-muted-foreground">{{ updatedAt(row.updated_at) }}</span></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </section>
</template>
