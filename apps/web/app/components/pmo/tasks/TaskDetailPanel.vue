<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { ApiError } from '@/composables/useApi'
import { withTaskListFilters } from '@/composables/taskFilterParams'
import { normalizeTaskSort } from '@/composables/taskSort'
import { useTaskFilters } from '@/composables/useTaskFilters'
import { shortcutKey } from '@liwan/ui/app/composables/shortcuts/keymap'
import type { TaskListParams } from '@/composables/useTasks'
import { useArchiveTask, useTask, useTaskSiblings, useUpdateTask } from '@/composables/useTasks'
import { usePersonalStages } from '@/composables/usePersonalStages'
import StateMenu from './StateMenu.vue'
import { taskMenuItems, type TaskMenuStage } from './taskMenu'
import TaskCompletionApproval from './TaskCompletionApproval.vue'
import TaskDetails from './TaskDetails.vue'
import TaskProperties from './TaskProperties.vue'
import TaskTitleEditor from './TaskTitleEditor.vue'

// The task record (`SharedRecordWorkspace`): one header row with the editable name, the status menu, the position in
// the list, previous/next and the ⋯ menu; the main column holds approval, description, sub-tasks, attachments,
// predecessors and the activity feed; the properties sit in the aside. The trail ends with the task.
// basePath routes prev/next within the host's own URL space (default /tasks,
// مهامي's own list). siblingParams lets a host that keeps its filters in the
// URL (the project screen) drive prev/next from those instead of the
// localStorage-backed filters — decided once per instance since the two
// branches are different composables.
const props = withDefaults(defineProps<{ taskId: number; basePath?: string; siblingParams?: TaskListParams; backTo?: RouteLocationRaw }>(), {
  basePath: '/tasks',
})
const emit = defineEmits<{ close: [] }>()

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
// The arrows point at list *order*, not at a fixed screen side: in RTL
// "previous" is the right-hand chevron, in LTR the left-hand one. The icons are
// drawn for RTL and `ltr:rotate-180` mirrors them, as the shared page header does.

const idRef = computed(() => props.taskId)
const backTo = computed(() => props.backTo ?? { path: '/tasks', query: route.query })
const { data: task, error, refetch } = useTask(idRef)
// A host that keeps its filters in the URL (the project screen) passes them
// in via siblingParams; the /tasks host passes nothing, so this falls back to
// the same localStorage-backed filters ref the table itself queries with,
// meaning prev/next reads the cache entry for the filter actually visible
// in the list rather than whichever list happened to be cached first.
// Decided once per instance: the two branches are different composables.
const localFilters = props.siblingParams ? null : useTaskFilters()
// The list's sort and filters travel in the URL, so prev/next follows the list as it was shown.
const filterParams = computed<TaskListParams>(() => props.siblingParams ?? { ...withTaskListFilters(localFilters!.value, route.query), all: true, sort: normalizeTaskSort(route.query.sort) })
const siblings = useTaskSiblings(idRef, filterParams)
const hydrated = useHydrated()
const toast = useToast()

// --- archive -------------------------------------------------------------
// The server exposes the record-specific archive action.
const { mutateAsync: archiveMutate, isPending: archiving } = useArchiveTask()
const archiveConfirmOpen = ref(false)

async function doArchive() {
  if (!task.value?.allowed_actions.includes('archive')) return
  try {
    await archiveMutate({ id: task.value.id })
    archiveConfirmOpen.value = false
    toast.add({ title: t('tasks.drawer.archived'), color: 'success' })
    emit('close')
  } catch (e) {
    toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
  }
}

watch(() => props.taskId, () => {
  archiveConfirmOpen.value = false
})

function siblingTo(id: number) {
  return { path: `${props.basePath}/${id}`, query: route.query }
}

function goTo(id: number | null) {
  if (!hydrated.value || id === null) return
  router.push(siblingTo(id))
}

function onKeydown(e: KeyboardEvent) {
  if (!hydrated.value || e.defaultPrevented) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (isEditableKeyTarget(e.target)) return
  // PageHeader owns ordinary Escape-back. While an archive confirmation is open, its back target is suppressed.
  if (e.key === 'Escape') return
  // By the shell keymap rule, so «ت» / «ن» on an Arabic layout move too.
  const key = shortcutKey(e)
  if (key === 'j') goTo(siblings.value.nextId)
  else if (key === 'k') goTo(siblings.value.prevId)
}

useEventListener(document, 'keydown', onKeydown)
const title = computed(() => task.value?.name ?? t('tasks.detail.pageLabel'))
// The task's project sits in the heading as a short fact, but only on the plain `/tasks` host: inside a project
// the trail already names it.
const headerTags = computed<PageHeaderTag[]>(() => {
  const current = task.value
  if (!current?.project || props.basePath !== '/tasks') return []
  return [{ label: current.project.name, icon: 'i-lucide-folder-kanban', to: `/projects/${current.project.id}`, testId: 'task-detail-context', kind: 'project' }]
})

// Projects › Alpha › Tasks › Write the brief. The list step carries the filters the task was opened from.
const trail = computed(() => {
  const project = task.value?.project
  const inProject = props.basePath.startsWith('/projects/')
  return [
    ...(inProject && project ? [{ label: t('nav.projects'), to: '/projects' }, { label: project.name, to: `/projects/${project.id}` }] : []),
    { label: t(inProject ? 'projects.tabs.tasks' : 'nav.tasks'), to: backTo.value, testId: 'task-detail-back' },
    { label: title.value },
  ]
})

// --- the ⋯ menu ------------------------------------------------------------
const { data: stages } = usePersonalStages()
const { mutate: updateTask } = useUpdateTask()

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    toast.add({ title: t('tasks.detail.linkCopied'), color: 'success' })
  } catch {
    toast.add({ title: t('errors.generic'), color: 'error' })
  }
}

function setStage(stage: TaskMenuStage | null) {
  if (!task.value?.can_write) return
  updateTask({
    id: task.value.id,
    patch: { personal_stage_type_id: stage?.id ?? null },
    resolved: { personal_stage: stage ? { id: stage.id, name: stage.name } : null },
  })
}

const menuItems = computed(() => task.value
  ? taskMenuItems({
    task: task.value,
    stages: stages.value ?? [],
    t,
    disabled: !hydrated.value || archiving.value,
    copyLink,
    setStage,
    archive: () => { archiveConfirmOpen.value = true },
  })
  : [])
</script>

<template>
  <SharedRecordWorkspace
    :title="title"
    :trail="trail"
    :back-to="archiveConfirmOpen ? undefined : backTo"
    :loading="!task && !error"
    :error="error"
    :keep-content="!!task"
    @retry="refetch"
  >
    <template v-if="task" #title>
      <TaskTitleEditor :task="task" />
    </template>
    <template #status>
      <StateMenu v-if="task" :task="task" :can-approve="task.can_approve" />
    </template>
    <template #meta>
      <SharedHeaderTags :tags="headerTags" />
    </template>
    <template v-if="task" #actions>
      <div data-testid="task-detail-nav" class="flex flex-none items-center gap-1" role="group" :aria-label="t('tasks.detail.navigation')">
        <span v-if="siblings.position" data-testid="task-position" class="me-1 text-sm text-muted tabular-nums">{{ t('tasks.detail.position', { n: siblings.position, total: siblings.total }) }}</span>
        <UTooltip :text="t('tasks.detail.prev')">
          <UButton color="neutral" variant="ghost" size="sm" square type="button" :aria-label="t('tasks.detail.prev')" :disabled="!hydrated || !siblings.prevId" @click="goTo(siblings.prevId)">
            <UIcon name="i-lucide-chevron-right" class="size-4.5 ltr:rotate-180" aria-hidden="true" />
          </UButton>
        </UTooltip>
        <UTooltip :text="t('tasks.detail.next')">
          <UButton color="neutral" variant="ghost" size="sm" square type="button" :aria-label="t('tasks.detail.next')" :disabled="!hydrated || !siblings.nextId" @click="goTo(siblings.nextId)">
            <UIcon name="i-lucide-chevron-left" class="size-4.5 ltr:rotate-180" aria-hidden="true" />
          </UButton>
        </UTooltip>
      </div>
      <UDropdownMenu :items="menuItems" :content="{ align: 'end' }">
        <UButton data-testid="task-detail-menu" color="neutral" variant="ghost" size="sm" square type="button" icon="i-lucide-ellipsis" :disabled="!hydrated" :aria-label="t('tasks.detail.menu')" />
      </UDropdownMenu>
    </template>

    <template v-if="task" #main>
      <SharedInlineConfirm v-if="archiveConfirmOpen" data-testid="task-archive-confirm" :title="t('tasks.drawer.archive')" :description="t('tasks.drawer.archiveConfirm')" :confirm-label="t('tasks.drawer.archive')" :pending="archiving" @confirm="doArchive" @cancel="archiveConfirmOpen = false" />
      <TaskCompletionApproval :task="task" />
      <TaskDetails :key="task.id" :task="task" :base-path="props.basePath">
        <template v-if="$slots.details" #schedule>
          <slot name="details" :task="task" />
        </template>
      </TaskDetails>
    </template>
    <template v-if="task" #aside>
      <TaskProperties :key="task.id" :task="task" />
    </template>
  </SharedRecordWorkspace>
</template>
