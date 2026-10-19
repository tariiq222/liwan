<script setup lang="ts">
import RequestKpiStrip from '@/components/operations/RequestKpiStrip.vue'
import RequestList from '@/components/operations/RequestList.vue'
import { useRequestListPage } from '@/composables/operations/listPage'
const page = useRequestListPage('mine')
</script>
<template>
  <SharedListPage v-bind="page" kpi-toggle>
    <RequestKpiStrip scope="mine" />
    <RequestList scope="mine" />
  </SharedListPage>
</template>
