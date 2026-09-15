<script setup lang="ts">
import ProjectTemplateList from '@/pages/project-templates/index.vue'

const route = useRoute()
const isCreateRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/project-templates/new')
</script>

<template>
  <ProjectTemplateList v-if="isCreateRoute" />
  <NuxtPage />
</template>
