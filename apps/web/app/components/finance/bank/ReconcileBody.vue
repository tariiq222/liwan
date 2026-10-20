<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceReconcileProposal } from '@webvue/contracts'
import Money from '../invoices/Money.vue'
import AccountPicker from '../AccountPicker.vue'
import { canWriteOffTo, toggleSelected } from './reconcileModel'
import type { BankReconcileState } from './useBankReconcilePage'

// The main column of a line's reconciliation page: the line, the open items to tick (the exact-amount ones are
// marked), the difference that remains with the account that takes it, and the inline confirmation. A line that is
// already reconciled shows a note and no action.
defineProps<{ page: BankReconcileState }>()
const { t } = useI18n()
const dash = computed(() => t('app.notAvailable'))

const end = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<FinanceReconcileProposal>[]>(() => [
  { id: 'date', header: t('financeBank.columns.date') },
  { id: 'entry', header: t('financeBank.reconcile.entry') },
  { id: 'label', header: t('financeBank.columns.label') },
  { id: 'partner', header: t('financeBank.columns.partner') },
  { id: 'account', header: t('financeBank.reconcile.account') },
  { id: 'amount_residual', header: t('financeBank.columns.residual'), meta: end },
])
</script>

<template>
  <template v-if="page.line && page.statement">
    <SharedRecordSection variant="action" :title="t('financeBank.reconcile.lineTitle')" :description="page.open ? t('financeBank.reconcile.lineHint') : undefined" data-testid="finance-bank-reconcile-line">
      <dl class="grid gap-2 text-sm sm:grid-cols-2">
        <div class="flex items-center justify-between gap-3"><dt class="text-muted">{{ t('financeBank.columns.date') }}</dt><dd><bdi class="tabular-nums">{{ page.line.date }}</bdi></dd></div>
        <div class="flex items-center justify-between gap-3"><dt class="text-muted">{{ t('financeBank.columns.label') }}</dt><dd class="font-semibold text-highlighted">{{ page.line.payment_ref }}</dd></div>
        <div class="flex items-center justify-between gap-3"><dt class="text-muted">{{ t('financeBank.columns.partner') }}</dt><dd>{{ page.line.partner?.name ?? dash }}</dd></div>
        <div class="flex items-center justify-between gap-3"><dt class="text-muted">{{ t('financeBank.columns.amount') }}</dt><dd><Money :amount="page.line.amount" :currency="page.statement.currency" /></dd></div>
        <div class="flex items-center justify-between gap-3"><dt class="text-muted">{{ t('financeBank.columns.residual') }}</dt><dd class="font-semibold text-highlighted"><Money :amount="page.line.amount_residual" :currency="page.statement.currency" /></dd></div>
      </dl>
    </SharedRecordSection>

    <SharedRecordSection v-if="!page.open" variant="tinted" :title="t('financeBank.reconcile.doneTitle')" :description="t('financeBank.reconcile.doneHint')" data-testid="finance-bank-reconcile-done" />

    <template v-else>
      <UAlert v-if="page.actionError" role="alert" color="error" variant="subtle" :title="page.actionError" data-testid="finance-bank-reconcile-error" />

      <SharedRecordSection variant="list" :title="t('financeBank.reconcile.proposals')" :description="t('financeBank.reconcile.proposalsHint')" data-testid="finance-bank-proposals">
        <SharedPageState :loading="page.proposalsQuery.isLoading" :error="page.proposalsQuery.error" :empty="!page.proposalsQuery.isLoading && !page.proposals.length" :empty-text="t('financeBank.reconcile.noProposals')" @retry="page.proposalsQuery.refetch">
          <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,820px)]">
            <SharedDataTable v-model:selected="page.selected" bare selectable :rows="page.proposals" :columns="columns" row-key="id" :caption="t('financeBank.reconcile.proposals')">
              <template #date-cell="{ row }"><bdi class="tabular-nums">{{ row.original.date }}</bdi></template>
              <template #entry-cell="{ row }">
                <span class="flex flex-wrap items-center gap-2">
                  <bdi :data-testid="`finance-bank-proposal-${row.original.id}`">{{ row.original.entry ?? dash }}</bdi>
                  <SharedStatusBadge v-if="row.original.exact" size="sm" tone="success" :label="t('financeBank.reconcile.exact')" />
                </span>
              </template>
              <template #label-cell="{ row }">{{ row.original.label }}</template>
              <template #partner-cell="{ row }">{{ row.original.partner?.name ?? dash }}</template>
              <template #account-cell="{ row }">{{ row.original.account.name }}</template>
              <template #amount_residual-cell="{ row }"><Money :amount="row.original.amount_residual" :currency="page.statement.currency" /></template>
              <template #mobile-row="{ row }">
                <div class="flex min-w-0 items-start gap-3">
                <UCheckbox
                  class="pt-0.5"
                  :model-value="page.selected.includes(row.id)"
                  :aria-label="t('financeBank.reconcile.selectProposal', { entry: row.entry ?? row.label })"
                  :disabled="!page.hydrated || page.pending"
                  :data-testid="`finance-bank-proposal-select-${row.id}`"
                  @update:model-value="(value: boolean | 'indeterminate') => page.selected = toggleSelected(page.selected, row.id, value === true)"
                />
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <span class="flex items-center justify-between gap-2">
                    <span class="min-w-0 truncate font-semibold text-highlighted"><bdi>{{ row.entry ?? row.label }}</bdi></span>
                    <SharedStatusBadge v-if="row.exact" size="sm" tone="success" :label="t('financeBank.reconcile.exact')" />
                  </span>
                  <span class="truncate text-sm text-muted">{{ row.partner?.name ?? dash }} · {{ row.account.name }}</span>
                  <Money :amount="row.amount_residual" :currency="page.statement.currency" />
                </div>
                </div>
              </template>
            </SharedDataTable>
          </div>
        </SharedPageState>
      </SharedRecordSection>

      <SharedRecordSection variant="panel" :title="t('financeBank.reconcile.summary')" data-testid="finance-bank-reconcile-summary">
        <div class="grid gap-4">
          <dl class="grid gap-2 text-sm">
            <div class="flex items-center justify-between gap-3"><dt class="text-muted">{{ t('financeBank.columns.residual') }}</dt><dd><Money :amount="page.line.amount_residual" :currency="page.statement.currency" /></dd></div>
            <div class="flex items-center justify-between gap-3"><dt class="text-muted">{{ t('financeBank.reconcile.selected', { count: page.selected.length }, page.selected.length) }}</dt><dd data-testid="finance-bank-selected-total"><Money :amount="page.selectedSum" :currency="page.statement.currency" /></dd></div>
            <div class="flex items-center justify-between gap-3 font-semibold text-highlighted"><dt>{{ t('financeBank.reconcile.difference') }}</dt><dd data-testid="finance-bank-difference-total"><Money :amount="page.difference" :currency="page.statement.currency" /></dd></div>
          </dl>
          <div v-if="!page.balanced" class="grid gap-4" data-testid="finance-bank-writeoff">
            <UAlert color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('financeBank.reconcile.writeOffHint')" />
            <UFormField :label="t('financeBank.reconcile.writeOffAccount')" name="finance-bank-writeoff-account" required>
              <AccountPicker id="finance-bank-writeoff-account" v-model="page.writeOff.accountId" :allow="canWriteOffTo" :placeholder="t('financeBank.reconcile.accountPlaceholder')" :disabled="page.pending" />
            </UFormField>
            <UFormField :label="t('financeBank.reconcile.writeOffLabel')" name="finance-bank-writeoff-label">
              <UInput id="finance-bank-writeoff-label" v-model="page.writeOff.label" class="w-full" maxlength="255" :disabled="!page.hydrated || page.pending" />
            </UFormField>
          </div>
          <SharedInlineConfirm v-if="page.confirming" :title="t('financeBank.reconcile.confirm')" :description="t('financeBank.reconcile.confirmHint')" :confirm-label="t('financeBank.reconcile.action')" color="primary" :pending="page.pending" :disabled="!page.hydrated || !page.body" @confirm="page.submit()" @cancel="page.confirming = false" />
          <div v-else class="flex justify-end">
            <UButton color="primary" icon="i-lucide-link" :disabled="!page.hydrated || !page.body" :label="t('financeBank.reconcile.review')" data-testid="finance-bank-reconcile-review" @click="page.confirming = true" />
          </div>
        </div>
      </SharedRecordSection>
    </template>
  </template>
</template>
