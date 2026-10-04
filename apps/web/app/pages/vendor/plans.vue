<script setup lang="ts">
import PlanList from '@/pages/vendor/plans/index.vue'
const route = useRoute()
const isCreateRoute = computed(() => route.path.replace(/\/+$/, '') === '/vendor/plans/new')
</script>
<template><PlanList v-if="isCreateRoute" /><NuxtPage /></template>
