<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProjectEvm } from '@/composables/useProjectEvm'
import { useProjectMissing } from '@/composables/useProjects'
import EvmCurve from '@/components/pmo/projects/evm/EvmCurve.vue'
import EvmIndices from '@/components/pmo/projects/evm/EvmIndices.vue'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import { formatLiwanDate } from '@liwan/ui/app/composables/calendarDate'

// Earned value as of today against the latest baseline. Everything is computed on the server; this page only presents it.
const route = useRoute()
const { t } = useI18n()
const id = computed(() => Number(route.params.id))
const evm = useProjectEvm(id)
const notFound = useProjectMissing(id)
const noBaseline = computed(() => evm.error.value instanceof ApiError && evm.error.value.code === 'no_baseline')
const data = computed(() => evm.data.value)
</script>

<template>
  <ProjectNotFoundState v-if="notFound" />
  <SharedListPage v-else hide-header :title="t('projects.evm.title')">
    <SharedEmptyState v-if="noBaseline" bordered :title="t('projects.evm.noBaseline')" :description="t('projects.evm.noBaselineHint')" data-testid="evm-no-baseline">
      <template #action><UButton color="neutral" variant="outline" :to="`/projects/${id}/baselines`" :label="t('nav.projectBaselines')" /></template>
    </SharedEmptyState>
    <SharedPageState v-else-if="evm.error.value" :error="evm.error.value" @retry="evm.refetch" />
    <template v-else-if="data">
      <div class="space-y-1 text-sm text-muted" data-testid="evm-method">
        <p>{{ t('projects.evm.asOf', { number: data.baseline_number, date: formatLiwanDate(data.as_of) }) }}</p>
        <p>{{ t(`projects.evm.method.${data.method}`) }}</p>
      </div>
      <UAlert v-if="data.hidden_count" color="warning" variant="subtle" data-testid="evm-hidden" :description="t('projects.evm.hidden', { count: data.hidden_count }, data.hidden_count)" />
      <UAlert v-if="data.undated_count" color="neutral" variant="subtle" data-testid="evm-undated" :description="t('projects.evm.undated', { count: data.undated_count }, data.undated_count)" />
      <UAlert v-if="data.bac === 0" color="neutral" variant="subtle" data-testid="evm-no-budget" :description="t('projects.evm.noBudget')" />
      <EvmIndices :evm="data" />
      <SharedRecordSection variant="panel" :title="t('projects.evm.curveTitle')" :description="t('projects.evm.curveHint')">
        <SharedEmptyState v-if="!data.planned_curve.length" :title="t('projects.evm.noCurve')" />
        <ClientOnly v-else>
          <EvmCurve :evm="data" />
        </ClientOnly>
      </SharedRecordSection>
    </template>
    <SharedPageState v-else :loading="evm.isLoading.value" />
  </SharedListPage>
</template>
