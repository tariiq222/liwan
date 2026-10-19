<script setup lang="ts">
import RequestKpiStrip from '@/components/operations/RequestKpiStrip.vue'
import RequestList from '@/components/operations/RequestList.vue'
import { useRequestListPage } from '@/composables/operations/listPage'
const page = useRequestListPage('pending')
</script>
<template>
  <SharedListPage v-bind="page" kpi-toggle>
    <RequestKpiStrip scope="pending" />
    <RequestList scope="pending" />
  </SharedListPage>
</template>
