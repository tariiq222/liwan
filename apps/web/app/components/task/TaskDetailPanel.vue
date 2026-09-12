<script setup lang="ts">
import { inject } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { ApiError } from '@/composables/useApi'
import { useTaskFilters } from '@/composables/useTaskFilters'
import type { TaskListParams } from '@/composables/useTasks'
import { useArchiveTask, useTask, useTaskSiblings, useUpdateTask } from '@/composables/useTasks'
import { PROJECT_OVERLAY_INJECTION_KEY } from '@/utils/projectOverlayRoute'
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
const { t, localeProperties } = useI18n()
const inProjectOverlay = inject<boolean>(PROJECT_OVERLAY_INJECTION_KEY, false)
// The chevrons point at list *order*, not at a fixed screen side: in RTL
// "previous" is the right-hand arrow, in LTR the left-hand one. They were
// hardcoded to the RTL pairing, so an `en` user saw them swapped.
const isRtl = computed(() => localeProperties.value.dir === 'rtl')

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

function isEditableTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

function onKeydown(e: KeyboardEvent) {
  if (!hydrated.value) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (isEditableTarget(e.target)) return
  if (editingTitle.value || titleSaving.value) {
    if (e.key === 'Escape' && !titleSaving.value) cancelTitleEdit()
    return
  }
  if (e.key === 'Escape') {
    // Let nested menus/popovers and the archive confirmation consume their
    // own Escape key before the page-level back action runs.
    if (archiveConfirmOpen.value || document.querySelector('[role="menu"][data-state="open"], [role="listbox"][data-state="open"], [data-reka-popper-content-wrapper] [data-state="open"], [role="dialog"][data-state="open"]:not(.nasq-ui-route-sheet)')) return
    emit('close')
    return
  }
  if (e.key === 'j' || e.key === 'J') goTo(siblings.value.nextId)
  else if (e.key === 'k' || e.key === 'K') goTo(siblings.value.prevId)
}

useEventListener(document, 'keydown', onKeydown)
</script>

<template>
  <div data-nasq-reference-detail class="space-y-6">
    <div class="task-context-row" data-testid="task-detail-context">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <NuxtLink v-if="!inProjectOverlay" :to="backTo" class="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-highlighted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :aria-label="props.backLabel ?? t('tasks.detail.back')" :aria-disabled="!hydrated || editingTitle || titleSaving" :tabindex="!hydrated || editingTitle || titleSaving ? -1 : undefined" @click="(!hydrated || editingTitle || titleSaving) && $event.preventDefault()">
          <UIcon :name="isRtl ? 'i-lucide-arrow-right' : 'i-lucide-arrow-left'" class="size-[18px]" aria-hidden="true" />
          <span>{{ props.backLabel ?? t('tasks.detail.back') }}</span>
        </NuxtLink>

        <template v-if="task && editingTitle">
          <UInput
            v-model="titleDraft"
            data-testid="task-title-input"
            :aria-label="t('tasks.newTitle')"
            class="h-8 min-w-0 flex-1"
            :disabled="titleSaving"
            @keydown.enter.prevent="saveTitle"
            @keydown.escape.stop.prevent="cancelTitleEdit"
          />
          <UButton data-testid="task-title-save" variant="outline" size="sm" type="button" :aria-label="t('tasks.detail.saveTitle')" :disabled="titleSaving || !titleDraft.trim()" @click="saveTitle">
            <UIcon name="i-lucide-check" class="size-[18px]" aria-hidden="true" />
          </UButton>
          <UButton data-testid="task-title-cancel" variant="ghost" size="sm" type="button" :aria-label="t('tasks.detail.cancelTitle')" :disabled="titleSaving" @click="cancelTitleEdit">
            <UIcon name="i-lucide-x" class="size-[18px]" aria-hidden="true" />
          </UButton>
        </template>
        <template v-else-if="task?.project">
          <span class="text-xs text-muted">{{ t('tasks.project') }}</span>
          <NuxtLink :to="`/projects/${task.project.id}`" class="min-w-0 truncate text-sm font-semibold hover:underline">
            {{ task.project.name }}
          </NuxtLink>
        </template>
        <USkeleton v-else class="h-5 min-w-0 flex-1" />
      </div>

      <div class="task-context-actions" role="group" :aria-label="t('tasks.detail.menu')">
        <UButton v-if="task?.can_write && !editingTitle" data-testid="task-title-edit" variant="outline" size="sm" type="button" :aria-label="t('tasks.detail.editTitle')" :disabled="!hydrated || titleSaving" @click="startTitleEdit">
          <UIcon name="i-lucide-pencil" class="size-[18px]" aria-hidden="true" />
        </UButton>
        <UButton variant="outline" size="sm" type="button" :aria-label="t('tasks.detail.prev')" :disabled="!hydrated || editingTitle || titleSaving || !siblings.prevId" @click="goTo(siblings.prevId)">
          <UIcon :name="isRtl ? 'i-lucide-chevron-right' : 'i-lucide-chevron-left'" class="size-[18px]" aria-hidden="true" />
        </UButton>
        <UButton variant="outline" size="sm" type="button" :aria-label="t('tasks.detail.next')" :disabled="!hydrated || editingTitle || titleSaving || !siblings.nextId" @click="goTo(siblings.nextId)">
          <UIcon :name="isRtl ? 'i-lucide-chevron-left' : 'i-lucide-chevron-right'" class="size-[18px]" aria-hidden="true" />
        </UButton>
        <UButton
          v-if="task?.allowed_actions.includes('archive')"
          data-testid="task-archive"
          variant="outline"
          size="sm"
          type="button"
          class="text-muted"
          :disabled="!hydrated || editingTitle || titleSaving || archiving"
          :aria-label="t('tasks.drawer.archive')"
          :title="t('tasks.drawer.archive')"
          @click="archiveConfirmOpen = true"
        >
          <UIcon name="i-lucide-archive" class="size-[18px]" aria-hidden="true" />
        </UButton>
      </div>
    </div>

    <div v-if="task && archiveConfirmOpen" data-testid="task-archive-confirm" class="rounded-lg border border-error/30 bg-error/5 space-y-2 p-4 text-sm">
      <p class="font-medium">{{ t('tasks.drawer.archive') }}</p>
      <p class="text-muted">{{ t('tasks.drawer.archiveConfirm') }}</p>
      <div class="flex flex-wrap gap-2">
        <UButton color="neutral" variant="outline" type="button" :disabled="archiving" @click="archiveConfirmOpen = false">{{ t('app.cancel') }}</UButton>
        <UButton color="error" type="button" :disabled="archiving" @click="doArchive">{{ t('tasks.drawer.archive') }}</UButton>
      </div>
    </div>

    <SharedPageState v-if="error" :error="error" @retry="refetch" />

    <UCard v-if="!task" :ui="{ body: 'flex min-h-56 items-center justify-center' }">
      <USkeleton class="h-40 w-full" />
    </UCard>

    <template v-if="task">
      <div data-testid="task-detail-grid" class="space-y-6">
        <div data-testid="task-details-card" class="nasq-ui-record-surface space-y-6 p-5">
          <div class="task-detail-status-line">
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

<style scoped>
.task-context-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.task-context-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
}

.task-detail-status-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 600px) {
  .task-context-row {
    display: grid;
    align-items: start;
  }

  .task-context-actions {
    justify-content: flex-start;
  }
}
</style>
