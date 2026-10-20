<script setup lang="ts">
import AccountList from '@/components/finance/accounting/AccountList.vue'
import { useAccountListPage } from '@/components/finance/accounting/useAccountListPage'

const page = useAccountListPage()
</script>

<template>
  <SharedListPage v-bind="page"><AccountList /></SharedListPage>
</template>
