<script setup lang="ts">
import EntryForm from '@/components/finance/accounting/EntryForm.vue'
import EntryList from '@/components/finance/accounting/EntryList.vue'
import { useEntryCreatePage } from '@/components/finance/accounting/useEntryCreatePage'

const { t } = useI18n()
const page = useEntryCreatePage()
</script>

<template>
  <SharedListPage v-bind="page.list.header">
    <template v-if="page.list.allowed" #kpis>
      <SharedKpiStrip v-if="page.list.kpis.shown && !page.list.kpis.error" :tiles="page.list.kpis.tiles" :loading="page.list.kpis.loading" :label="page.list.kpis.label" data-testid="finance-entry-kpis" />
    </template>
    <EntryList background />
  </SharedListPage>
  <SharedCreatePanel size="wide" :title="page.title" :back-to="page.backTo">
    <EntryForm v-if="page.allowed" :back-to="page.backTo" @saved="page.saved" />
    <SharedForbiddenState v-else :description="t('financeAccounting.forbidden')" />
  </SharedCreatePanel>
</template>
