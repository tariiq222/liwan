<script setup lang="ts">
import ProcessList from '@/components/operations/ProcessList.vue'
import { useProcessListPage } from '@/composables/operations/listPage'
const page = useProcessListPage()
</script>
<template><SharedListPage v-bind="page"><ProcessList /></SharedListPage></template>
