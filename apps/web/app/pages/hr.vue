<script setup lang="ts">
import HrDirectory from '@/pages/hr/index.vue'

const route = useRoute()
const isCreateRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/hr/employees/new')
</script>

<template>
  <HrDirectory v-if="isCreateRoute" />
  <NuxtPage />
</template>
