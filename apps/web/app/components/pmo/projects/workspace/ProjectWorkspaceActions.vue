<script setup lang="ts">
import type { ProjectDetail } from '@liwan/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import { useProjectArchive } from '@/composables/useProjectArchive'
import { useProjectList } from '@/composables/useProjects'
import { canCopyProject } from '@/utils/projectCopyAccess'
import { projectActionPage } from '@/utils/projectHeaderAction'
import { projectSectionLocation } from '@/utils/projectWorkspaceMemory'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'

// The end of the workspace header (DESIGN.md §4): the one primary action of the page below (a new task on the summary and the
// task list, a new meeting on the meetings) and a ⋯ menu for the rest: settings, copy, the KPI toggle and archive.
const props = defineProps<{ project: ProjectDetail }>()
const emit = defineEmits<{ archive: [] }>()

const route = useRoute()
const router = useRouter()
const opening = useListOpening()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const { shown: kpisShown, toggle: toggleKpis } = useKpiVisibility()
const { restore, pending } = useProjectArchive(() => props.project)

const page = computed(() => projectActionPage(route.path))
const projectId = computed(() => props.project.id)

// A task list keeps its filters on the way to the form, like the list's own button did; the summary returns to itself.
const taskCreateQuery = computed(() => {
  if (page.value !== 'tasks') return returnToQuery(route.fullPath)
  const { returnTo: _referrer, ...listState } = route.query
  return listState
})
const primary = computed(() => {
  if (!props.project.active) return null
  if (page.value === 'meetings') {
    if (!can('meetings.create')) return null
    return {
      label: t('meetingsUi.new'), testId: 'project-meetings-create',
      to: { path: '/meetings/new', query: { project_id: String(projectId.value), project_name: props.project.name, ...returnToQuery(route.fullPath) } },
    }
  }
  if (!page.value || !can('pmo.tasks.create')) return null
  return { label: t('projects.workspace.newTask'), testId: 'project-header-create', to: { path: `/projects/${projectId.value}/tasks/new`, query: taskCreateQuery.value } }
})

// The task list writes its search into the URL after a short debounce, so a click right after typing would carry the old text to the
// form (and back). A plain click on the list therefore reads the live search box, like the list's own links do; any other click is the link's.
async function openWithLiveSearch(event: MouseEvent) {
  if (page.value !== 'tasks' || !primary.value || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const live = document.querySelector<HTMLInputElement>('main [data-shortcut-search] input')
  if (!live) return
  event.preventDefault()
  opening.value = true
  try {
    await router.push({ ...primary.value.to, query: { ...taskCreateQuery.value, q: live.value.trim() || undefined } })
  } finally {
    opening.value = false
  }
}

// Copying needs the server's create signal (the same one the projects list uses); a one-row list query carries it.
const { data: createSignal } = useProjectList(ref(false), { limit: 1 })
const canCopy = computed(() => canCopyProject(true, createSignal.value?.can_create, can('pmo.tasks.read')))
const settingsTo = computed(() => projectSectionLocation(`/projects/${projectId.value}/settings`, route.path, route.query))
const copyTo = computed(() => ({ path: '/projects/new', query: { copyFrom: String(projectId.value), ...returnToQuery(route.fullPath) } }))

const items = computed<DropdownMenuItem[][]>(() => {
  const main: DropdownMenuItem[] = []
  if (props.project.can_manage) main.push({ label: t('nav.projectSettings'), icon: 'i-lucide-settings', to: settingsTo.value, exact: true })
  if (canCopy.value) main.push({ label: t('projects.copy.action'), icon: 'i-lucide-copy', to: copyTo.value })
  // The task list is the one project page with a KPI strip.
  if (page.value === 'tasks') main.push({ label: kpisShown.value ? t('app.hideKpis') : t('app.showKpis'), icon: 'i-lucide-chart-no-axes-column', onSelect: toggleKpis })
  const lifecycle: DropdownMenuItem[] = []
  if (props.project.can_manage) {
    lifecycle.push(props.project.active
      ? { label: t('projects.menu.archive'), icon: 'i-lucide-archive', color: 'error', onSelect: () => emit('archive') }
      : { label: t('projects.menu.unarchive'), icon: 'i-lucide-archive-restore', disabled: pending.value, onSelect: () => { void restore() } })
  }
  return [main, lifecycle].filter(group => group.length)
})
</script>

<template>
  <div class="ms-auto flex min-w-0 max-w-full flex-wrap items-center gap-2.5 pointer-coarse:*:min-h-11" data-testid="project-workspace-actions">
    <UButton
      v-if="primary"
      :to="primary.to"
      icon="i-lucide-plus"
      data-shortcut-create
      aria-keyshortcuts="c"
      :data-testid="primary.testId"
      :disabled="!hydrated"
      @click="openWithLiveSearch"
    >{{ primary.label }}</UButton>
    <UTooltip v-if="items.length" :text="t('projects.workspace.moreActions')">
      <UDropdownMenu :items="items" :content="{ align: 'end' }">
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          square
          icon="i-lucide-ellipsis"
          data-testid="project-workspace-menu"
          :disabled="!hydrated"
          :aria-label="t('projects.workspace.moreActions')"
        />
      </UDropdownMenu>
    </UTooltip>
  </div>
</template>
