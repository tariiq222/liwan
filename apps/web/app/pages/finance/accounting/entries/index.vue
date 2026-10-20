<script setup lang="ts">
import EntryList from '@/components/finance/accounting/EntryList.vue'
import { useEntryListPage } from '@/components/finance/accounting/useEntryListPage'

const page = useEntryListPage()
</script>

<template>
  <SharedListPage v-bind="page"><EntryList /></SharedListPage>
</template>
