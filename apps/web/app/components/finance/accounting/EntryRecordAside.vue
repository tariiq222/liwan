<script setup lang="ts">
import Money from '../invoices/Money.vue'
import type { EntryRecordState } from './useEntryRecord'

// The aside of an entry's record page: its properties.
defineProps<{ record: EntryRecordState }>()
const { t } = useI18n()
</script>

<template>
  <SharedPropertiesPanel v-if="record.entry">
    <SharedPropertyRow :label="t('financeAccounting.columns.number')"><bdi>{{ record.entry.name ?? t('financeAccounting.draftNumber') }}</bdi></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeAccounting.columns.date')"><bdi class="tabular-nums">{{ record.entry.date }}</bdi></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeAccounting.columns.journal')" :value="record.entry.journal.name" />
    <SharedPropertyRow :label="t('financeAccounting.columns.ref')" :value="record.entry.ref || null" />
    <SharedPropertyRow :label="t('financeAccounting.record.currency')" :value="record.entry.currency" />
    <SharedPropertyRow :label="t('financeAccounting.columns.total')"><Money :amount="record.entry.amount_total" :currency="record.entry.currency" /></SharedPropertyRow>
  </SharedPropertiesPanel>
</template>
