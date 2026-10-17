<script setup lang="ts">
import RequestList from '@/components/operations/RequestList.vue'
import { useRequestListPage } from '@/composables/operations/listPage'
const page = useRequestListPage('monitoring')
</script>
<template><SharedListPage v-bind="page"><RequestList scope="monitoring" /></SharedListPage></template>
