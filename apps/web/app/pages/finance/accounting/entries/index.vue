<script setup lang="ts">
import EntryList from '@/components/finance/accounting/EntryList.vue'
import { useEntryListPage } from '@/components/finance/accounting/useEntryListPage'

const page = useEntryListPage()
</script>

<template>
  <SharedListPage v-bind="page.header">
    <template v-if="page.allowed" #kpis>
      <SharedKpiStrip v-if="page.kpis.shown" :tiles="page.kpis.tiles" :loading="page.kpis.loading" :label="page.kpis.label" data-testid="finance-entry-kpis" />
    </template>
    <EntryList />
  </SharedListPage>
</template>
