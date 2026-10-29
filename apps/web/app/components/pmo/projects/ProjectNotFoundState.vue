<script setup lang="ts">
// One answer for a project the user cannot open (missing, or hidden by a record rule): the same text and way back on every section.
const { t } = useI18n()
</script>

<template>
  <SharedPageContainer width="list">
    <div class="flex flex-col items-start gap-(--webvue-gap-card)" data-testid="project-not-found">
      <p class="text-muted">{{ t('projects.notFound') }}</p>
      <UButton to="/projects" color="neutral" variant="outline" size="sm">{{ t('projects.backToProjects') }}</UButton>
    </div>
  </SharedPageContainer>
</template>
