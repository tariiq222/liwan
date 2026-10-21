<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceZatcaWaitingDocument } from '@webvue/contracts'
import { useFinanceZatcaWaitingDocuments, ZATCA_WAITING_PAGE_SIZE } from '@/composables/finance/useFinanceZatca'
import { invoiceRecordPath, invoiceTitle } from '../invoices/invoiceKinds'
import { ZATCA_STATE_TONE } from '../invoices/invoiceTones'
import Money from '../invoices/Money.vue'

// The e-invoices ZATCA has not accepted, oldest first, with the first message ZATCA or the local check gave. Each row opens its
// invoice, where it is corrected or sent again; nothing is sent from the list. E-invoicing is sandbox-only in this phase.
const WAITING = ['pending', 'retry', 'rejected', 'blocked', 'unauthorized'] as const
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const state = ref<string>('all')
const page = ref(1)
const query = useFinanceZatcaWaitingDocuments(() => ({ state: state.value === 'all' ? null : state.value, page: page.value }), () => can('finance.zatca.read'))
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / ZATCA_WAITING_PAGE_SIZE)))
const stateItems = computed(() => [{ value: 'all', label: t('financeGovernance.zatca.work.allStates') }, ...WAITING.map(value => ({ value, label: t(`financeDocuments.zatcaStates.${value}`) }))])
const columns = computed<TableColumn<FinanceZatcaWaitingDocument>[]>(() => [
  { id: 'invoice', header: t('financeGovernance.zatca.work.invoice') },
  { id: 'partner', header: t('financeGovernance.zatca.work.partner') },
  { id: 'date', header: t('financeGovernance.zatca.work.date') },
  { id: 'amount', header: t('financeGovernance.zatca.work.amount'), meta: { class: { th: 'text-end', td: 'text-end' } } },
  { id: 'state', header: t('financeGovernance.zatca.work.state') },
])
const dash = computed(() => t('app.notAvailable'))
const title = (row: FinanceZatcaWaitingDocument) => invoiceTitle(row.invoice, t('financeDocuments.draftNumber'))
const to = (row: FinanceZatcaWaitingDocument) => invoiceRecordPath(row.move_type as Parameters<typeof invoiceRecordPath>[0], row.invoice.id)
const firstMessage = (row: FinanceZatcaWaitingDocument) => row.submission.errors[0] ?? row.submission.warnings[0] ?? null
function choose(value: unknown) { state.value = String(value); page.value = 1 }
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('financeGovernance.zatca.work.title')" :description="t('financeGovernance.zatca.work.hint')" data-testid="finance-zatca-work-list">
    <div class="grid gap-(--webvue-gap-card)">
      <UFormField :label="t('financeGovernance.zatca.work.state')" name="finance-zatca-work-state" class="w-full sm:w-64">
        <USelect id="finance-zatca-work-state" :model-value="state" :items="stateItems" class="w-full" :disabled="!hydrated" @update:model-value="choose" />
      </UFormField>
      <SharedPageState :loading="query.isPending.value" :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
        <SharedEmptyState v-if="!items.length" :title="t('financeGovernance.zatca.work.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,720px)]">
          <SharedDataTable bare :rows="items" :columns="columns" :row-key="row => row.invoice.id" :caption="t('financeGovernance.zatca.work.title')">
            <template #invoice-cell="{ row }">
              <NuxtLink :to="to(row.original)" class="font-semibold text-primary hover:underline" :data-testid="`finance-zatca-work-${row.original.invoice.id}`"><bdi>{{ title(row.original) }}</bdi></NuxtLink>
              <span v-if="firstMessage(row.original)" class="block max-w-md truncate text-xs text-muted"><bdi v-if="firstMessage(row.original)!.code">{{ firstMessage(row.original)!.code }}</bdi> {{ firstMessage(row.original)!.message }}</span>
            </template>
            <template #partner-cell="{ row }">{{ row.original.partner?.name ?? dash }}</template>
            <template #date-cell="{ row }"><bdi class="tabular-nums">{{ row.original.date ?? dash }}</bdi></template>
            <template #amount-cell="{ row }"><Money :amount="row.original.amount_total" /></template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="ZATCA_STATE_TONE[row.original.submission.state]" :label="t(`financeDocuments.zatcaStates.${row.original.submission.state}`)" /></template>
            <template #mobile-row="{ row }">
              <div class="flex min-w-0 flex-col gap-1">
                <span class="flex items-center justify-between gap-2">
                  <NuxtLink :to="to(row)" class="min-w-0 truncate font-semibold text-primary"><bdi>{{ title(row) }}</bdi></NuxtLink>
                  <SharedStatusBadge size="sm" :tone="ZATCA_STATE_TONE[row.submission.state]" :label="t(`financeDocuments.zatcaStates.${row.submission.state}`)" />
                </span>
                <span class="truncate text-sm text-muted">{{ row.partner?.name ?? dash }} · <bdi class="tabular-nums">{{ row.date ?? dash }}</bdi></span>
                <span v-if="firstMessage(row)" class="truncate text-xs text-muted">{{ firstMessage(row)!.message }}</span>
                <Money :amount="row.amount_total" />
              </div>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <SharedListFooter v-if="total > 0" :count-label="t('financeGovernance.zatca.work.footer', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="!hydrated || query.isFetching.value" count-test-id="finance-zatca-work-count" @update:page="value => { page = value }" />
    </div>
  </SharedRecordSection>
</template>
