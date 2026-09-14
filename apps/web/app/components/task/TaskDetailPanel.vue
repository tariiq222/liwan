<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { ApiError } from '@/composables/useApi'
import { useTaskFilters } from '@/composables/useTaskFilters'
import type { TaskListParams } from '@/composables/useTasks'
import { useArchiveTask, useTask, useTaskSiblings, useUpdateTask } from '@/composables/useTasks'
import DeadlineBadge from './DeadlineBadge.vue'
import StateMenu from './StateMenu.vue'
import TaskCompletionApproval from './TaskCompletionApproval.vue'
import TaskDetails from './TaskDetails.vue'

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
// in via siblingParams; مهامي's host passes nothing, so this falls back to
// the same localStorage-backed filters ref the table itself queries with,
// meaning prev/next reads the cache entry for the filter actually visible
// in the list rather than whichever list happened to be cached first.
// Decided once per instance: the two branches are different composables.
const localFilters = props.siblingParams ? null : useTaskFilters()
const filterParams = computed<TaskListParams>(() => props.siblingParams ?? localFilters!.value)
const siblings = useTaskSiblings(idRef, filterParams)
const { mutate: updateTask, isPending: titleSaving } = useUpdateTask()
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

const titleDraft = ref('')
const editingTitle = ref(false)
watch(() => props.taskId, () => {
  editingTitle.value = false
  archiveConfirmOpen.value = false
})
watch(
  () => task.value?.name,
  (name) => {
    if (name !== undefined && !editingTitle.value) titleDraft.value = name
  },
  { immediate: true },
)

async function startTitleEdit() {
  if (!hydrated.value || !task.value?.can_write || titleSaving.value) return
  titleDraft.value = task.value.name
  editingTitle.value = true
  await nextTick()
  const input = document.querySelector<HTMLInputElement>('[data-testid="task-title-input"]')
  input?.focus()
  input?.select()
}

async function focusTitleEditControl() {
  await nextTick()
  document.querySelector<HTMLButtonElement>('[data-testid="task-title-edit"]')?.focus()
}

async function cancelTitleEdit() {
  if (titleSaving.value) return
  titleDraft.value = task.value?.name ?? ''
  editingTitle.value = false
  await focusTitleEditControl()
}

function saveTitle() {
  if (!hydrated.value || !task.value?.can_write) return
  const name = titleDraft.value.trim()
  if (!name || name === task.value.name) {
    titleDraft.value = task.value.name
    editingTitle.value = false
    void focusTitleEditControl()
    return
  }
  updateTask(
    { id: task.value.id, patch: { name } },
    {
      onSuccess: () => {
        editingTitle.value = false
        void focusTitleEditControl()
      },
      onError: (error) => {
        toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
      },
    },
  )
}

function siblingTo(id: number) {
  return { path: `${props.basePath}/${id}`, query: route.query }
}

function goTo(id: number | null) {
  if (!hydrated.value || id === null) return
  router.push(siblingTo(id))
}

function onKeydown(e: KeyboardEvent) {
  if (!hydrated.value) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (isEditableKeyTarget(e.target)) return
  if (editingTitle.value || titleSaving.value) {
    if (e.key === 'Escape' && !titleSaving.value) cancelTitleEdit()
    return
  }
  if (e.key === 'Escape') {
    // Let nested menus/popovers and the archive confirmation consume their
    // own Escape key before the page-level back action runs.
    if (archiveConfirmOpen.value || overlayOwnsEscape(document)) return
    emit('close')
    return
  }
  if (e.key === 'j' || e.key === 'J') goTo(siblings.value.nextId)
  else if (e.key === 'k' || e.key === 'K') goTo(siblings.value.prevId)
}

useEventListener(document, 'keydown', onKeydown)
</script>

<template>
  <div class="nasq-page-width-detail space-y-6">
    <div class="flex min-w-0 flex-col items-stretch gap-2.5 sm:flex-row sm:items-center sm:justify-between" data-testid="task-detail-context">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <UButton
          :to="backTo"
          data-testid="task-detail-back"
          color="neutral"
          variant="outline"
          size="sm"
          class="shrink-0"
          :disabled="!hydrated || editingTitle || titleSaving"
        >
          <UIcon name="i-lucide-arrow-right" aria-hidden="true" class="size-4.5 ltr:rotate-180" />{{ props.backLabel ?? t('tasks.detail.back') }}
        </UButton>

        <template v-if="task && editingTitle">
          <UInput
            v-model="titleDraft"
            data-testid="task-title-input"
            :aria-label="t('tasks.newTitle')"
            class="min-w-0 flex-1"
            size="sm"
            :disabled="titleSaving"
            @keydown.enter.prevent="saveTitle"
            @keydown.escape.stop.prevent="cancelTitleEdit"
          />
          <UButton data-testid="task-title-save" variant="outline" size="sm" square type="button" icon="i-lucide-check" :aria-label="t('tasks.detail.saveTitle')" :loading="titleSaving" :disabled="titleSaving || !titleDraft.trim()" @click="saveTitle" />
          <UButton data-testid="task-title-cancel" color="neutral" variant="outline" size="sm" square type="button" icon="i-lucide-x" :aria-label="t('tasks.detail.cancelTitle')" :disabled="titleSaving" @click="cancelTitleEdit" />
        </template>
        <template v-else-if="task?.project">
          <span class="text-xs text-muted">{{ t('tasks.project') }}</span>
          <NuxtLink :to="`/projects/${task.project.id}`" class="min-w-0 truncate text-sm font-semibold hover:underline">
            {{ task.project.name }}
          </NuxtLink>
        </template>
        <USkeleton v-else class="h-5 min-w-0 flex-1" />
      </div>

      <div class="flex flex-none items-center gap-1.5" role="group" :aria-label="t('tasks.detail.menu')">
        <UButton v-if="task?.can_write && !editingTitle" data-testid="task-title-edit" color="neutral" variant="outline" size="sm" square type="button" icon="i-lucide-pencil" :aria-label="t('tasks.detail.editTitle')" :disabled="!hydrated || titleSaving" @click="startTitleEdit" />
        <UButton color="neutral" variant="outline" size="sm" square type="button" :aria-label="t('tasks.detail.prev')" :disabled="!hydrated || editingTitle || titleSaving || !siblings.prevId" @click="goTo(siblings.prevId)">
          <UIcon name="i-lucide-chevron-right" class="size-4.5 ltr:rotate-180" aria-hidden="true" />
        </UButton>
        <UButton color="neutral" variant="outline" size="sm" square type="button" :aria-label="t('tasks.detail.next')" :disabled="!hydrated || editingTitle || titleSaving || !siblings.nextId" @click="goTo(siblings.nextId)">
          <UIcon name="i-lucide-chevron-left" class="size-4.5 ltr:rotate-180" aria-hidden="true" />
        </UButton>
        <UButton
          v-if="task?.allowed_actions.includes('archive')"
          data-testid="task-archive"
          color="neutral"
          variant="outline"
          size="sm"
          square
          type="button"
          icon="i-lucide-archive"
          :disabled="!hydrated || editingTitle || titleSaving || archiving"
          :aria-label="t('tasks.drawer.archive')"
          :title="t('tasks.drawer.archive')"
          @click="archiveConfirmOpen = true"
        />
      </div>
    </div>

    <SharedInlineConfirm
      v-if="task && archiveConfirmOpen"
      data-testid="task-archive-confirm"
      :title="t('tasks.drawer.archive')"
      :description="t('tasks.drawer.archiveConfirm')"
      :confirm-label="t('tasks.drawer.archive')"
      :pending="archiving"
      @confirm="doArchive"
      @cancel="archiveConfirmOpen = false"
    />

    <SharedPageState v-if="error" :error="error" @retry="refetch" />

    <UCard v-if="!task" :ui="{ body: 'flex min-h-56 items-center justify-center' }">
      <USkeleton class="h-40 w-full" />
    </UCard>

    <template v-if="task">
      <div data-testid="task-detail-grid" class="space-y-6">
        <div data-testid="task-details-card" class="rounded-lg ring ring-default bg-default overflow-hidden space-y-6 p-5">
          <div class="flex flex-wrap items-center gap-2">
            <StateMenu :task="task" :can-approve="task.can_approve" />
            <span class="text-xs text-muted">
              {{ t('tasks.detail.workflowStage') }}: {{ task.stage?.name ?? t('tasks.detail.stageUnset') }}
            </span>
            <DeadlineBadge :deadline="task.date_deadline" :days-remaining="task.days_remaining" :is-closed="task.is_closed" />
          </div>
          <TaskCompletionApproval :task="task" />
          <TaskDetails :key="task.id" :task="task" :base-path="props.basePath" />
        </div>
      </div>
    </template>
  </div>
</template>
