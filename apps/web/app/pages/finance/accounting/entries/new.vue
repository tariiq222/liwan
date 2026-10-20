<script setup lang="ts">
import EntryForm from '@/components/finance/accounting/EntryForm.vue'
import EntryList from '@/components/finance/accounting/EntryList.vue'
import { useEntryCreatePage } from '@/components/finance/accounting/useEntryCreatePage'

const { t } = useI18n()
const page = useEntryCreatePage()
</script>

<template>
  <SharedListPage v-bind="page.list"><EntryList background /></SharedListPage>
  <SharedCreatePanel :title="page.title" :back-to="page.backTo">
    <EntryForm v-if="page.allowed" :back-to="page.backTo" @saved="page.saved" />
    <SharedForbiddenState v-else :description="t('financeAccounting.forbidden')" />
  </SharedCreatePanel>
</template>
