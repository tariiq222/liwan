<script setup lang="ts">
import type { Project } from '@nasq/contracts'
import ProjectMenu from './ProjectMenu.vue'
import ProjectProgress from './ProjectProgress.vue'
import ProjectStatusBadge from './ProjectStatusBadge.vue'
import EmptyState from '@/components/shared/EmptyState.vue'
import { formatCalendarDate } from '@/composables/calendarDate'
import { returnToQuery } from '@/utils/safeReturnTo'

type ProjectListItem = Project & { manager?: { id: number; name: string } | null; date_end?: string | null }
const props = defineProps<{ items: ProjectListItem[]; isLoading: boolean; archived: boolean; filtered: boolean; capped?: boolean }>()
const emit = defineEmits<{ open: [id: number] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const route = useRoute()

function open(project: Project, event: MouseEvent) {
  if (!hydrated.value || (event.target as HTMLElement).closest('a, button, [role="menu"]')) return
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
  <div v-if="isLoading || !hydrated" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    <Skeleton v-for="n in 6" :key="n" class="h-40 rounded-lg" />
  </div>
  <div v-else-if="items.length === 0" class="nasq-panel p-6">
    <EmptyState
      :title="t(filtered ? 'projects.filteredEmpty' : archived ? 'projects.archivedEmpty' : 'projects.empty')"
      :description="t(filtered ? 'projects.filteredEmptyHint' : archived ? 'projects.archivedEmptyHint' : 'projects.emptyHint')"
    />
  </div>
  <div v-else class="space-y-2">
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
      v-for="project in items"
      :key="project.id"
      class="nasq-panel cursor-pointer p-4 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="project-card"
      tabindex="0"
      :aria-labelledby="`project-card-${project.id}`"
      @click="open(project, $event)"
      @keydown="openWithKeyboard(project, $event)"
      >
        <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 :id="`project-card-${project.id}`" class="truncate text-sm font-semibold"><NuxtLink :to="{ path: `/projects/${project.id}`, query: returnToQuery(route.fullPath) }" class="hover:underline">{{ project.name }}</NuxtLink></h2>
          <p class="mt-1 text-[11px] text-muted-foreground">{{ t('projects.projectId', { id: project.id }) }}</p>
        </div>
        <ProjectStatusBadge :status="project.status" />
        </div>
        <div class="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{{ t('projects.progressOf', { closed: project.closed_task_count, total: project.task_count }) }}</span>
          <ProjectMenu :project="project" hide-settings />
        </div>
        <ProjectProgress class="mt-3" :progress="project.progress" :task-count="project.task_count" :closed-task-count="project.closed_task_count" compact />
        <div class="mt-4 flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
          <span class="min-w-0 truncate"><span class="sr-only">{{ t('projects.columns.manager') }}: </span>{{ project.manager?.name ?? '—' }}</span>
          <span dir="ltr">{{ project.date_end ? formatCalendarDate(project.date_end, locale) : '—' }}</span>
        </div>
      </article>
    </div>
    <p v-if="capped" class="text-xs text-muted-foreground">{{ t('projects.capped') }}</p>
  </div>
</template>
