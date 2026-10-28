<script setup lang="ts">
import CrmOpportunityList from '@/components/crm/opportunity/CrmOpportunityList.vue'
import { useOpportunityListPage } from '@/composables/crm/useOpportunityListPage'
const page = useOpportunityListPage()
</script>

<template>
  <SharedListPage v-bind="page" #default="{ view }">
    <CrmOpportunityList :view="view" />
  </SharedListPage>
</template>
