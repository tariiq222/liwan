<script setup lang="ts">
import ProjectTemplateList from '@/pages/projects/templates/index.vue'

const route = useRoute()
const isCreateRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/projects/templates/new')
</script>

<template>
  <ProjectTemplateList v-if="isCreateRoute" />
  <NuxtPage />
</template>
