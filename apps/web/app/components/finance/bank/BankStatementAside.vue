<script setup lang="ts">
import { hasEndDifference } from './bankModel'
import Money from '../invoices/Money.vue'
import type { BankStatementRecordState } from './useBankStatementRecord'

// The aside of a statement's record page: its properties, with the ending balance the bank printed next to the computed one.
defineProps<{ record: BankStatementRecordState }>()
const { t } = useI18n()
</script>

<template>
  <SharedPropertiesPanel v-if="record.statement">
    <SharedPropertyRow :label="t('financeBank.columns.date')"><bdi class="tabular-nums">{{ record.statement.date ?? t('app.notAvailable') }}</bdi></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeBank.columns.journal')" :value="record.statement.journal.name" />
    <SharedPropertyRow :label="t('financeBank.columns.balanceStart')"><Money :amount="record.statement.balance_start" :currency="record.statement.currency" /></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeBank.record.computedEnd')"><Money :amount="record.statement.balance_end" :currency="record.statement.currency" /></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeBank.columns.balanceEnd')"><Money :amount="record.statement.balance_end_real" :currency="record.statement.currency" /></SharedPropertyRow>
    <SharedPropertyRow v-if="hasEndDifference(record.statement)" :label="t('financeBank.columns.difference')"><SharedStatusBadge size="sm" tone="warning" :label="t('financeBank.differencePill')" /></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeBank.record.currency')" :value="record.statement.currency" />
    <SharedPropertyRow v-if="record.summary" :label="t('financeBank.summary.reconciled')"><span class="tabular-nums">{{ record.summary.reconciledCount }}</span> · <Money :amount="record.summary.reconciledAmount" :currency="record.statement.currency" /></SharedPropertyRow>
    <SharedPropertyRow v-if="record.summary" :label="t('financeBank.summary.open')"><span class="tabular-nums">{{ record.summary.openCount }}</span> · <Money :amount="record.summary.openAmount" :currency="record.statement.currency" /></SharedPropertyRow>
  </SharedPropertiesPanel>
</template>
