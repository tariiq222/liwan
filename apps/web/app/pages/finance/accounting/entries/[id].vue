<script setup lang="ts">
import FinanceRecordHero from '@/components/finance/FinanceRecordHero.vue'
import EntryRecordActions from '@/components/finance/accounting/EntryRecordActions.vue'
import EntryRecordAside from '@/components/finance/accounting/EntryRecordAside.vue'
import EntryRecordBody from '@/components/finance/accounting/EntryRecordBody.vue'
import { ENTRY_STATE_TONE } from '@/components/finance/accounting/entryTones'
import { useEntryRecord } from '@/components/finance/accounting/useEntryRecord'

const { t } = useI18n()
const record = useEntryRecord()
</script>

<template>
  <SharedRecordPage v-bind="record.header" @retry="record.retry">
    <template v-if="record.entry" #actions><EntryRecordActions :record="record" /></template>
    <template v-if="record.entry" #summary>
      <FinanceRecordHero
        icon="i-lucide-notebook-pen"
        :tone="ENTRY_STATE_TONE[record.entry.state]"
        :title="record.title"
        :status="t(`financeAccounting.states.${record.entry.state}`)"
        :amount="{ label: t('financeAccounting.columns.total'), value: record.entry.amount_total, currency: record.entry.currency }"
        data-testid="finance-entry-hero"
      />
    </template>
    <EntryRecordBody :record="record" />
    <template v-if="record.entry" #aside><EntryRecordAside :record="record" /></template>
  </SharedRecordPage>
</template>
