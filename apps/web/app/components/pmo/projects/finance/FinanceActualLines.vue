<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ActualLine, FinanceSummary } from '@liwan/contracts'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'
import { useProjectActualLines } from '@/composables/useProjectFinance'
import { FINANCE_PAGE, formatMoney } from '@/utils/projectFinance'

// The posted lines behind an external actual: a read-only table with its own paging. A line links to its record
// when an application declares where that kind opens and the user may read it.
const props = defineProps<{ projectId: number; summary: FinanceSummary }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const linkTo = useRecordLink()
const offset = ref(0)
const lines = useProjectActualLines(() => props.projectId, computed(() => ({ limit: FINANCE_PAGE, offset: offset.value })))
const items = computed(() => lines.data.value?.items ?? [])
const total = computed(() => lines.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / FINANCE_PAGE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / FINANCE_PAGE)))

const columns = computed<TableColumn<ActualLine>[]>(() => [
  { id: 'date', header: t('projects.finance.columns.date'), meta: { class: { td: 'whitespace-nowrap' } } },
  { id: 'label', header: t('projects.finance.actualLines.label'), meta: { class: { th: 'min-w-48', td: 'max-w-0 min-w-48 truncate' } } },
  { id: 'reference', header: t('projects.finance.columns.reference'), meta: { class: { td: 'whitespace-nowrap' } } },
  { id: 'partner', header: t('projects.finance.actualLines.partner'), meta: { class: { th: 'min-w-36', td: 'max-w-0 min-w-36 truncate' } } },
  { id: 'amount', header: t('projects.finance.columns.amount'), meta: { class: { th: 'text-end', td: 'text-end whitespace-nowrap' } } },
])
const recordTo = (line: ActualLine) => line.record ? linkTo(line.record.kind, line.record.id) : null
const dateLabel = (line: ActualLine) => formatCalendarDate(line.date, locale.value)
const empty = computed(() => !lines.isLoading.value && !lines.error.value && !items.value.length)

function setPage(next: number) {
  if (!hydrated.value || lines.isFetching.value || next < 1 || next > pages.value) return
  offset.value = (next - 1) * FINANCE_PAGE
}
</script>

<template>
  <SharedRecordSection data-testid="finance-actual-lines" :title="t('projects.finance.actualLines.title')" :description="t('projects.finance.actualLines.description')">
    <SharedListCard>
      <SharedDataTable
        bare
        :rows="items"
        :columns="columns"
        row-key="id"
        :loading="lines.isLoading.value"
        :error="lines.error.value"
        :empty-text="empty ? t('projects.finance.actualLines.empty') : undefined"
        :caption="t('projects.finance.actualLines.title')"
        @retry="lines.refetch"
      >
        <template #date-cell="{ row }">{{ dateLabel(row.original) }}</template>
        <template #label-cell="{ row }"><span data-testid="finance-actual-line" :title="row.original.label">{{ row.original.label }}</span></template>
        <template #reference-cell="{ row }">
          <NuxtLink v-if="recordTo(row.original) && row.original.reference" :to="recordTo(row.original)!" class="font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.reference }}</NuxtLink>
          <span v-else>{{ row.original.reference ?? '—' }}</span>
        </template>
        <template #partner-cell="{ row }">{{ row.original.partner?.name ?? '—' }}</template>
        <template #amount-cell="{ row }"><span dir="ltr" class="font-semibold tabular-nums text-highlighted">{{ formatMoney(row.original.amount, summary.currency) }}</span></template>
        <template #mobile-row="{ row: line }">
          <div data-testid="finance-actual-line-card" class="grid gap-(--liwan-gap-card)">
            <div class="flex items-start justify-between gap-3">
              <p class="min-w-0 font-semibold text-highlighted">{{ line.label }}</p>
              <span dir="ltr" class="shrink-0 font-semibold tabular-nums text-highlighted">{{ formatMoney(line.amount, summary.currency) }}</span>
            </div>
            <dl class="grid grid-cols-2 gap-(--liwan-gap-card) text-xs">
              <div><dt class="text-muted">{{ t('projects.finance.columns.date') }}</dt><dd>{{ dateLabel(line) }}</dd></div>
              <div>
                <dt class="text-muted">{{ t('projects.finance.columns.reference') }}</dt>
                <dd>
                  <NuxtLink v-if="recordTo(line) && line.reference" :to="recordTo(line)!" class="font-medium text-highlighted hover:underline">{{ line.reference }}</NuxtLink>
                  <template v-else>{{ line.reference ?? '—' }}</template>
                </dd>
              </div>
              <div class="col-span-2"><dt class="text-muted">{{ t('projects.finance.actualLines.partner') }}</dt><dd>{{ line.partner?.name ?? '—' }}</dd></div>
            </dl>
          </div>
        </template>
      </SharedDataTable>
      <template v-if="items.length" #footer>
        <SharedListFooter :count-label="t('projects.footer.results', { shown: items.length, total }, total)" count-test-id="finance-actual-lines-count" :page="page" :pages="pages" :disabled="lines.isFetching.value" @update:page="setPage" />
      </template>
    </SharedListCard>
  </SharedRecordSection>
</template>
