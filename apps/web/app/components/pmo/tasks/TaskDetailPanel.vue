<script setup lang="ts">
import { deadlineLabel, deadlineTone } from '@/composables/taskState'
import { taskDaysRemaining } from './taskDeadline'
import type { RouteLocationRaw } from 'vue-router'
import { statusTag, type PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { ApiError } from '@/composables/useApi'
import { withTaskListFilters } from '@/composables/taskFilterParams'
import { normalizeTaskSort } from '@/composables/taskSort'
import { useTaskFilters } from '@/composables/useTaskFilters'
import { shortcutKey } from '@liwan/ui/app/composables/shortcuts/keymap'
import type { TaskListParams } from '@/composables/useTasks'
import { useArchiveTask, useTask, useTaskSiblings } from '@/composables/useTasks'
import StateMenu from './StateMenu.vue'
import TaskCompletionApproval from './TaskCompletionApproval.vue'
import TaskDetails from './TaskDetails.vue'
import TaskProperties from './TaskProperties.vue'

// Container-agnostic body: a compact task context row followed by section
// tabs. The page wrapper owns the shell title so this component stays focused
// on task data, editing, activity, and navigation.
// basePath routes prev/next within the host's own URL space (default /tasks,
// مهامي's own list). siblingParams lets a host that keeps its filters in the
// URL (the project screen) drive prev/next from those instead of the
// localStorage-backed filters — decided once per instance since the two
// branches are different composables.
const props = withDefaults(defineProps<{ taskId: number; basePath?: string; siblingParams?: TaskListParams; backLabel?: string; backTo?: RouteLocationRaw }>(), {
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
// Counted from the same instant the Deadline property prints, so the badge and the date cannot disagree.
const deadlineDays = computed(() => (task.value ? taskDaysRemaining(task.value) : null))
// The task's context sits in the heading: its project (a link), the workflow stage and the deadline.
const headerTags = computed<PageHeaderTag[]>(() => {
  const current = task.value
  if (!current) return []
  return [
    ...(current.project ? [{ label: current.project.name, icon: 'i-lucide-folder-kanban', to: `/projects/${current.project.id}`, testId: 'task-detail-context', kind: 'project' as const }] : []),
    { label: `${t('tasks.detail.workflowStage')}: ${current.stage?.name ?? t('tasks.detail.stageUnset')}`, icon: 'i-lucide-git-commit-horizontal', kind: 'category' },
    statusTag({ tone: deadlineTone(deadlineDays.value, current.is_closed), label: deadlineLabel(deadlineDays.value, t) }, 'deadline-badge'),
  ]
})
</script>

<template>
  <SharedRecordPage
    :title="title"
    :tags="headerTags"
    :back-to="archiveConfirmOpen ? undefined : backTo"
    :back-label="props.backLabel ?? t('tasks.detail.back')"
    :loading="!task && !error"
    :error="error"
    :keep-content="!!task"
    @retry="refetch"
  >
    <template #back>
      <UButton :to="backTo" data-testid="task-detail-back" color="neutral" variant="outline" class="focus-visible:ring-2 focus-visible:ring-primary" :disabled="!hydrated">
        <UIcon name="i-lucide-arrow-right" aria-hidden="true" class="size-4.5 ltr:rotate-180" />{{ props.backLabel ?? t('tasks.detail.back') }}
      </UButton>
    </template>
    <template v-if="task" #actions>
      <div data-testid="task-detail-menu" class="flex flex-none items-center gap-1.5" role="group" :aria-label="t('tasks.detail.menu')">
        <UTooltip :text="t('tasks.detail.prev')">
          <UButton color="neutral" variant="outline" size="sm" square type="button" :aria-label="t('tasks.detail.prev')" :disabled="!hydrated || !siblings.prevId" @click="goTo(siblings.prevId)">
            <UIcon name="i-lucide-chevron-right" class="size-4.5 ltr:rotate-180" aria-hidden="true" />
          </UButton>
        </UTooltip>
        <UTooltip :text="t('tasks.detail.next')">
          <UButton color="neutral" variant="outline" size="sm" square type="button" :aria-label="t('tasks.detail.next')" :disabled="!hydrated || !siblings.nextId" @click="goTo(siblings.nextId)">
            <UIcon name="i-lucide-chevron-left" class="size-4.5 ltr:rotate-180" aria-hidden="true" />
          </UButton>
        </UTooltip>
        <UTooltip v-if="task.allowed_actions.includes('archive')" :text="t('tasks.drawer.archive')">
          <UButton data-testid="task-archive" color="neutral" variant="outline" size="sm" square type="button" icon="i-lucide-archive" :disabled="!hydrated || archiving" :aria-label="t('tasks.drawer.archive')" @click="archiveConfirmOpen = true" />
        </UTooltip>
      </div>
    </template>

    <template v-if="task">
      <SharedInlineConfirm v-if="archiveConfirmOpen" data-testid="task-archive-confirm" :title="t('tasks.drawer.archive')" :description="t('tasks.drawer.archiveConfirm')" :confirm-label="t('tasks.drawer.archive')" :pending="archiving" @confirm="doArchive" @cancel="archiveConfirmOpen = false" />

      <div data-testid="task-detail-grid" class="space-y-6">
        <div data-testid="task-details-card" class="space-y-6">
          <div class="flex flex-wrap items-center gap-2">
            <StateMenu :task="task" :can-approve="task.can_approve" />
          </div>
          <TaskCompletionApproval :task="task" />
          <TaskDetails :key="task.id" :task="task" :base-path="props.basePath" />
          <slot name="details" :task="task" />
        </div>
      </div>
    </template>
    <template v-if="task" #summary>
      <TaskProperties :key="task.id" :task="task" />
    </template>
  </SharedRecordPage>
</template>
