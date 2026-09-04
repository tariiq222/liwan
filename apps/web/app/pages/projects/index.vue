<script setup lang="ts">
import ProjectTable from '@/components/project/ProjectTable.vue'
const router = useRouter()
const { t } = useI18n()
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-semibold">{{ t('projects.title') }}</h1>
    <ProjectTable @open="(id) => router.push(`/projects/${id}`)" />
  </div>
</template>
