<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { useBaselineVariance, useProjectBaseline } from '@/composables/useProjectBaselines'
import BaselineVarianceTable from '@/components/pmo/projects/baselines/BaselineVarianceTable.vue'
import { formatLiwanDate } from '@liwan/ui/app/composables/calendarDate'
import { formatMoney } from '@/utils/projectFinance'

const route = useRoute()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const number = computed(() => Number(route.params.number))
const item = useProjectBaseline(projectId, number)
const variance = useBaselineVariance(projectId)
const listPaths = useProjectRecordListPaths(projectId, () => [`/projects/${projectId.value}/baselines`])
const backTo = computed(() => owningListBack(route.query, listPaths.value, route.hash))
// Variance is measured against the latest baseline only; an earlier snapshot is a record of what was planned then.
const isLatest = computed(() => variance.data.value?.baseline?.number === number.value)
const taskRows = computed(() => variance.data.value?.schedule?.tasks ?? [])
const share = (value: number) => `${Math.round(value * 1000) / 10}%`
const dates = (start: string | null, end: string | null) => start || end ? `${start ?? '—'} → ${end ?? '—'}` : t('projects.baselines.undated')
</script>

<template>
  <SharedRecordPage
    :keep-content="!!item.data.value"
    :title="item.data.value ? t('projects.baselines.detailTitle', { number: item.data.value.number }) : t('projects.baselines.title')"
    :back-to="backTo"
    :back-label="t('projects.baselines.title')"
    :loading="item.isLoading.value"
    :error="item.error.value"
    @retry="item.refetch"
  >
    <SharedEmptyState v-if="!item.data.value" :title="t('app.noResults')" />
    <template v-else>
      <SharedRecordSection v-if="item.data.value.note" variant="panel" :title="t('projects.baselines.fields.note')">
        <p class="whitespace-pre-wrap text-sm">{{ item.data.value.note }}</p>
      </SharedRecordSection>
      <SharedRecordSection v-if="isLatest && taskRows.length" variant="panel" :title="t('projects.baselines.variance.tasksTitle')" :description="t('projects.baselines.snapshotHint')">
        <BaselineVarianceTable :rows="taskRows" :project-id="projectId" />
      </SharedRecordSection>
      <SharedRecordSection v-else variant="panel" :title="t('projects.baselines.snapshotTitle')" :description="t('projects.baselines.snapshotHint')">
        <SharedEmptyState v-if="!item.data.value.tasks.length" :title="t('projects.baselines.noTasks')" />
        <ul v-else class="divide-y divide-default" data-testid="baseline-snapshot-tasks">
          <li v-for="line in item.data.value.tasks" :key="line.id" class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span class="min-w-0 font-medium text-highlighted">{{ line.name }}</span>
            <span class="flex items-center gap-3 text-muted">
              <span dir="ltr" class="tabular-nums">{{ dates(line.planned_start, line.planned_end) }}</span>
              <span dir="ltr" class="tabular-nums">{{ share(line.planned_value_share) }}</span>
            </span>
          </li>
        </ul>
      </SharedRecordSection>
    </template>
    <template v-if="item.data.value" #summary>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('projects.baselines.fields.takenAt')" :value="formatLiwanDate(item.data.value.taken_at) || null" />
        <SharedPropertyRow :label="t('projects.baselines.fields.takenBy')">
          <span class="inline-flex items-center gap-2"><SharedPersonAvatar :people="[item.data.value.taken_by]" />{{ item.data.value.taken_by.name }}</span>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.baselines.fields.plannedDates')"><span dir="ltr" class="tabular-nums">{{ dates(item.data.value.planned_start, item.data.value.planned_end) }}</span></SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.baselines.fields.budget')">
          <span dir="ltr" class="tabular-nums">{{ item.data.value.currency ? formatMoney(item.data.value.budget_total, item.data.value.currency) : item.data.value.budget_total }}</span>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.baselines.fields.tasks')" :value="String(item.data.value.task_count)" />
        <SharedPropertyRow v-if="item.data.value.hidden_count" :label="t('projects.baselines.fields.hidden')" :value="String(item.data.value.hidden_count)" />
        <SharedPropertyRow v-if="item.data.value.change" :label="t('projects.baselines.fields.change')">
          <NuxtLink :to="`/projects/${projectId}/changes/${item.data.value.change.id}`" class="hover:underline">#{{ item.data.value.change.number }} {{ item.data.value.change.title }}</NuxtLink>
        </SharedPropertyRow>
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
