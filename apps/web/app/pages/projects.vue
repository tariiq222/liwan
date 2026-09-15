<script setup lang="ts">
import ProjectList from '@/pages/projects/index.vue'

const route = useRoute()
const isCreateRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/projects/new')
</script>

<template>
  <ProjectList v-if="isCreateRoute" />
  <NuxtPage />
</template>
