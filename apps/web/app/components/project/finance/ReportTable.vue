<script setup lang="ts">
import type { ProjectReportRow } from '@nasq/contracts'
import EmptyState from '@/components/shared/EmptyState.vue'
import ProjectStatusBadge from '@/components/project/ProjectStatusBadge.vue'
import { budgetStatus, formatNullableAmount, formatNullableCount, formatNullablePercent } from '@/utils/projectFinance'
import { returnToQuery } from '@/utils/safeReturnTo'
import RecordNumber from '@/components/shared/RecordNumber.vue'

defineProps<{
  items: ProjectReportRow[]
  isLoading: boolean
  filtered: boolean
}>()
const { t } = useI18n()
const hydrated = useHydrated()
const route = useRoute()
const unknown = computed(() => t('projects.finance.unknown'))
const unavailable = computed(() => t('projects.reports.unavailable'))
</script>

<template>
  <div class="nasq-panel overflow-hidden">
    <div class="overflow-x-auto">
      <Table class="min-w-[1040px] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead class="w-28 text-start">{{ t('app.recordNumber') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.reports.columns.project') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.reports.columns.status') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.reports.columns.estimate') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.finance.planned') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.finance.actual') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.finance.remaining') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.finance.overBudget') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.reports.columns.tasks') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.reports.columns.progress') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="isLoading || !hydrated">
            <TableRow v-for="n in 5" :key="n">
              <TableCell v-for="col in 10" :key="col"><Skeleton class="h-5 w-full" /></TableCell>
            </TableRow>
          </template>
          <TableEmpty v-else-if="items.length === 0" :colspan="10">
            <EmptyState
              :title="t(filtered ? 'projects.reports.filteredEmpty' : 'projects.reports.empty')"
              :description="t(filtered ? 'projects.reports.filteredEmptyHint' : 'projects.reports.emptyHint')"
            />
          </TableEmpty>
          <TableRow v-else v-for="row in items" :key="row.project.id" data-testid="reports-row">
            <TableCell><RecordNumber :value="row.project.id" /></TableCell>
            <TableCell>
              <NuxtLink
                :to="{ path: `/projects/${row.project.id}/finance`, query: returnToQuery(route.fullPath) }"
                class="block truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {{ row.project.name }}
              </NuxtLink>
            </TableCell>
            <TableCell>
              <ProjectStatusBadge :status="row.project.status" />
            </TableCell>
            <TableCell><span dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.finance.charter_estimate, row.finance.currency, unknown) }}</span></TableCell>
            <TableCell><span dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.finance.planned, row.finance.currency, unknown) }}</span></TableCell>
            <TableCell><span dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.finance.actual, row.finance.currency, unknown) }}</span></TableCell>
            <TableCell><span dir="ltr" class="tabular-nums">{{ formatNullableAmount(row.finance.remaining, row.finance.currency, unknown) }}</span></TableCell>
            <TableCell>
              <Badge v-if="budgetStatus(row.finance) === 'unknown'" variant="outline">{{ t('projects.finance.budgetUnknown') }}</Badge>
              <Badge v-else-if="budgetStatus(row.finance) === 'over'" variant="destructive">{{ t('projects.finance.overBudget') }}</Badge>
              <span v-else class="text-muted-foreground">{{ t('projects.finance.onBudget') }}</span>
            </TableCell>
            <TableCell class="text-sm">
              <span class="tabular-nums">{{ formatNullableCount(row.task_count, unavailable) }}</span>
              <span class="block text-xs text-muted-foreground">
                {{ t('projects.reports.closedOf', { closed: formatNullableCount(row.closed_task_count, unavailable), overdue: formatNullableCount(row.overdue_task_count, unavailable) }) }}
              </span>
            </TableCell>
            <TableCell><span class="tabular-nums">{{ formatNullablePercent(row.progress, unavailable) }}</span></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
