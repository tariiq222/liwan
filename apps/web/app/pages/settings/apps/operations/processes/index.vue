<script setup lang="ts">
import ProcessList from '@/components/operations/ProcessList.vue'
import { useProcessListPage } from '@/composables/operations/listPage'
const page = useProcessListPage()
useSettingsPage('operations')
</script>
<template><SharedListPage v-bind="page"><section id="processes" class="liwan-settings-anchor"><ProcessList /></section></SharedListPage></template>
