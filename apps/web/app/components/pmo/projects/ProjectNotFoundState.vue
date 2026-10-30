<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

// One answer for a project the user cannot open (missing, or hidden by a record rule): the same text and way back on every section.
// `embedded` draws it inside a page that already has its container; `backTo` is the way back when it is not the project list.
const props = defineProps<{ backTo?: RouteLocationRaw; embedded?: boolean }>()
const { t } = useI18n()
const container = props.embedded ? 'div' : resolveComponent('SharedPageContainer')
</script>

<template>
  <component :is="container" :width="embedded ? undefined : 'list'">
    <div class="flex flex-col items-start gap-(--webvue-gap-card)" data-testid="project-not-found">
      <p class="text-muted">{{ t('projects.notFound') }}</p>
      <UButton :to="backTo ?? '/projects'" color="neutral" variant="outline" size="sm">{{ t('projects.backToProjects') }}</UButton>
    </div>
  </component>
</template>
