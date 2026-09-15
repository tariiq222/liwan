<script setup lang="ts">
import DepartmentList from '@/pages/hr/departments/index.vue'

const route = useRoute()
const isCreateRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/hr/departments/new')
</script>

<template>
  <DepartmentList v-if="isCreateRoute" />
  <NuxtPage />
</template>
