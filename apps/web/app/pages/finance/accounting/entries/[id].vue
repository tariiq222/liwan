<script setup lang="ts">
import EntryRecordActions from '@/components/finance/accounting/EntryRecordActions.vue'
import EntryRecordAside from '@/components/finance/accounting/EntryRecordAside.vue'
import EntryRecordBody from '@/components/finance/accounting/EntryRecordBody.vue'
import { useEntryRecord } from '@/components/finance/accounting/useEntryRecord'

const record = useEntryRecord()
</script>

<template>
  <SharedRecordPage v-bind="record.header" @retry="record.retry">
    <template v-if="record.entry" #actions><EntryRecordActions :record="record" /></template>
    <EntryRecordBody :record="record" />
    <template v-if="record.entry" #aside><EntryRecordAside :record="record" /></template>
  </SharedRecordPage>
</template>
