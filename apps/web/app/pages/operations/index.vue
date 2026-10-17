<script setup lang="ts">
import RequestList from '@/components/operations/RequestList.vue'
import { useRequestListPage } from '@/composables/operations/listPage'
const page = useRequestListPage('mine')
</script>
<template><SharedListPage v-bind="page"><RequestList scope="mine" /></SharedListPage></template>
