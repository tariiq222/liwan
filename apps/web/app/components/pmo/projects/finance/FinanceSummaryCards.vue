<script setup lang="ts">
import type { FinanceSummary } from '@nasq/contracts'
import { budgetStatus, financeSummaryMode, formatNullableAmount, formatUtilization } from '@/utils/projectFinance'
import { returnToQuery } from '@/utils/safeReturnTo'

const props = defineProps<{ projectId: number; summary: FinanceSummary; canManage?: boolean }>()
const { t } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const unknown = computed(() => t('projects.finance.unknown'))
const currency = computed(() => props.summary.currency)
const mode = computed(() => financeSummaryMode(props.summary))
const plannedStatus = computed(() => budgetStatus(props.summary))
const charterTo = computed(() => ({ path: `/projects/${props.projectId}/charter`, query: returnToQuery(route.fullPath) }))
const budgetTo = computed(() => ({ path: `/projects/${props.projectId}/finance/new`, query: { kind: 'budget', ...returnToQuery(route.fullPath) } }))
const showCharter = computed(() => props.summary.charter_estimate != null)
const show = computed(() => mode.value !== 'empty' || props.summary.charter_estimate != null)
</script>

<template>
  <div v-if="show" data-testid="project-finance-summary" class="grid gap-3">
    <SharedRecordSection v-if="mode === 'need-budget'" panel :title="t('projects.finance.actual')">
      <template #actions>
        <UButton v-if="canManage" icon="i-lucide-plus" :disabled="!hydrated" :to="budgetTo">{{ t('projects.finance.newBudget') }}</UButton>
        <UButton color="neutral" variant="outline" :to="charterTo" :label="t('projects.refresh.finance.viewCharter')" />
      </template>
      <div class="space-y-1">
        <p class="text-2xl font-medium tracking-tight text-highlighted tabular-nums" dir="ltr">{{ formatNullableAmount(summary.actual, currency, unknown) }}</p>
        <p class="text-xs text-muted">{{ t('projects.finance.budgetUnknown') }} · {{ t('projects.finance.expenseCount', { count: summary.expense_count }, summary.expense_count) }}</p>
      </div>
    </SharedRecordSection>

    <section v-else-if="mode === 'dashboard'" class="grid grid-cols-2 gap-3 sm:grid-cols-3 [&>:last-child:nth-child(odd)]:col-span-2 sm:[&>:last-child:nth-child(odd)]:col-span-1 max-sm:[&_[data-slot=body]]:gap-2 max-sm:[&_[data-slot=body]]:p-3 max-sm:[&_[data-slot=body]>span]:hidden">
      <SharedMetricTile
        icon="i-lucide-wallet"
        :label="t('projects.finance.planned')"
        :value="formatNullableAmount(summary.planned, currency, unknown)"
        value-dir="ltr"
        :hint="t('projects.finance.budgetCount', { count: summary.budget_count }, summary.budget_count)"
      />
      <SharedMetricTile
        icon="i-lucide-receipt"
        :label="t('projects.finance.actual')"
        :value="formatNullableAmount(summary.actual, currency, unknown)"
        value-dir="ltr"
        :hint="t('projects.finance.expenseCount', { count: summary.expense_count }, summary.expense_count)"
      />
      <SharedMetricTile
        icon="i-lucide-scale"
        :label="t('projects.finance.remaining')"
        :value="formatNullableAmount(summary.remaining, currency, unknown)"
        value-dir="ltr"
      >
        <p class="text-xs text-muted">
          {{ t('projects.finance.utilization') }}:
          <span dir="ltr">{{ formatUtilization(summary.utilization_percent, unknown) }}</span>
          <UBadge v-if="plannedStatus === 'over'" color="error" variant="subtle" class="ms-2 align-middle">{{ t('projects.finance.overBudget') }}</UBadge>
        </p>
      </SharedMetricTile>
    </section>

    <SharedRecordSection v-if="showCharter" panel data-testid="project-finance-charter" :title="t('projects.finance.charterEstimate')">
      <template #actions>
        <UButton color="neutral" variant="outline" :to="charterTo" :label="t('projects.refresh.finance.viewCharter')" />
      </template>
      <div class="space-y-1">
        <p class="text-sm font-medium tabular-nums text-highlighted" dir="ltr">{{ formatNullableAmount(summary.charter_estimate, currency, unknown) }}</p>
        <p class="text-xs text-muted">{{ t('projects.finance.charterHint') }}</p>
      </div>
    </SharedRecordSection>
  </div>
</template>
