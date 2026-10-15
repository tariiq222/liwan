<script setup lang="ts">
import type { Project } from '@nasq/contracts'
import type { RouteLocationRaw } from 'vue-router'
import ProjectCardBody from './ProjectCardBody.vue'

// The cards view of /projects. Empty and error states belong to the page; this draws the cards
// or, while loading, the shared card skeleton.
type ProjectListItem = Project & { manager?: { id: number; name: string } | null; date_end?: string | null }
defineProps<{
  items: ProjectListItem[]
  isLoading: boolean
  toFor: (project: ProjectListItem) => RouteLocationRaw
}>()
const emit = defineEmits<{ open: [id: number] }>()
const hydrated = useHydrated()

function open(project: Project, event: MouseEvent) {
  if (!hydrated.value || (event.target as HTMLElement).closest('a, button, [role="menu"], [role="alert"]')) return
  emit('open', project.id)
}
function openWithKeyboard(project: Project, event: KeyboardEvent) {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
  event.preventDefault()
  if (!hydrated.value) return
  emit('open', project.id)
}
</script>

<template>
  <SharedLoadingSkeleton v-if="isLoading" variant="cards" :count="6" />
  <div v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    <article
      v-for="project in items"
      :key="project.id"
      class="cursor-pointer rounded-lg bg-default p-4 ring ring-default transition-colors hover:bg-elevated/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      data-testid="project-card"
      tabindex="0"
      :aria-labelledby="`project-card-${project.id}`"
      @click="open(project, $event)"
      @keydown="openWithKeyboard(project, $event)"
    >
      <ProjectCardBody :project="project" :to-for="toFor" />
    </article>
  </div>
</template>
