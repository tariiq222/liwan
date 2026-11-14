<script setup lang="ts">
import ContextDocuments from '@/lib/documents/ContextDocuments.vue'
import { useProject } from '@/composables/useProjects'
const route = useRoute()
const project = useProject(computed(() => Number(route.params.id)))
</script>

<template>
  <SharedPageContainer><ContextDocuments :project-id="route.params.id" :project-writable="project.data.value?.active && project.data.value.can_manage" /></SharedPageContainer>
</template>
