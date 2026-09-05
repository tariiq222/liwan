<script setup lang="ts">
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useTaskFilters } from '@/composables/useTaskFilters'
import type { TaskListParams } from '@/composables/useTasks'
import { useArchiveTask, useTask, useTaskSiblings, useUpdateTask } from '@/composables/useTasks'
import DeadlineBadge from './DeadlineBadge.vue'
import StateMenu from './StateMenu.vue'
import TaskActivity from './TaskActivity.vue'
import TaskDetails from './TaskDetails.vue'

// Container-agnostic body: header (title, state, project chip, deadline
// badge, prev/next, close) + the two-column (details/activity) layout. The
// The page wrapper lives in TaskDetailPage.vue so this component stays focused
// on task data, editing, activity, and navigation.
// basePath routes prev/next within the host's own URL space (default /tasks,
// مهامي's own list). siblingParams lets a host that keeps its filters in the
// URL (the project screen) drive prev/next from those instead of the
// localStorage-backed filters — decided once per instance since the two
// branches are different composables.
const props = withDefaults(defineProps<{ taskId: number; basePath?: string; siblingParams?: TaskListParams }>(), { basePath: '/tasks' })
const emit = defineEmits<{ close: [] }>()

const route = useRoute()
const router = useRouter()
const { t, localeProperties } = useI18n()
// The chevrons point at list *order*, not at a fixed screen side: in RTL
// "previous" is the right-hand arrow, in LTR the left-hand one. They were
// hardcoded to the RTL pairing, so an `en` user saw them swapped.
const isRtl = computed(() => localeProperties.value.dir === 'rtl')

// Direct loads of /tasks/{id} are SSR'd, so this needs an SSR guess:
// ssrWidth assumes desktop (matches the md breakpoint) to avoid rendering
// the mobile Tabs layout — and its editor/pickers — only to replace it on
// hydration for the common case.
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })

const idRef = computed(() => props.taskId)
const { data: task } = useTask(idRef)
// A host that keeps its filters in the URL (the project screen) passes them
// in via siblingParams; مهامي's host passes nothing, so this falls back to
// the same localStorage-backed filters ref the table itself queries with,
// meaning prev/next reads the cache entry for the filter actually visible
// in the list rather than whichever list happened to be cached first.
// Decided once per instance: the two branches are different composables.
const localFilters = props.siblingParams ? null : useTaskFilters()
const filterParams = computed<TaskListParams>(() => props.siblingParams ?? localFilters!.value)
const siblings = useTaskSiblings(idRef, filterParams)
const { mutate: updateTask } = useUpdateTask()
const hydrated = useHydrated()

// --- archive -------------------------------------------------------------
// The server exposes the record-specific archive action.
const { mutateAsync: archiveMutate, isPending: archiving } = useArchiveTask()
const archiveConfirmOpen = ref(false)

async function doArchive() {
  if (!task.value?.allowed_actions.includes('archive')) return
  try {
    await archiveMutate({ id: task.value.id })
    archiveConfirmOpen.value = false
    toast.success(t('tasks.drawer.archived'))
    emit('close')
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}

const titleDraft = ref('')
watch(
  () => task.value?.name,
  (name) => {
    if (name !== undefined) titleDraft.value = name
  },
  { immediate: true },
)

function saveTitle() {
  if (!task.value?.can_write) return
  const name = titleDraft.value.trim()
  if (!name || name === task.value.name) {
    titleDraft.value = task.value.name
    return
  }
  updateTask({ id: task.value.id, patch: { name } })
}

function goTo(id: number | null) {
  if (id === null) return
  router.push({ path: `${props.basePath}/${id}`, query: route.query })
}

function isEditableTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

function onKeydown(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (isEditableTarget(e.target)) return
  if (e.key === 'Escape') {
    // Let nested menus/popovers and the archive confirmation consume their
    // own Escape key before the page-level back action runs.
    if (archiveConfirmOpen.value || document.querySelector('[data-state="open"][data-slot$="content"]')) return
    emit('close')
    return
  }
  if (e.key === 'j' || e.key === 'J') goTo(siblings.value.nextId)
  else if (e.key === 'k' || e.key === 'K') goTo(siblings.value.prevId)
}

useEventListener(document, 'keydown', onKeydown)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <header class="space-y-3 border-b p-3 sm:p-4">
      <div class="flex min-w-0 items-center gap-2">
        <Input
          v-if="task"
          :readonly="!task.can_write"
          v-model="titleDraft"
          :aria-label="t('tasks.newTitle')"
          class="h-9 min-w-0 flex-1 border-none px-0 text-base font-semibold shadow-none focus-visible:ring-0 sm:text-lg"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
          @blur="saveTitle"
        />
        <Skeleton v-else class="h-7 min-w-0 flex-1" />

        <div class="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" type="button" :aria-label="t('tasks.detail.prev')" :disabled="!siblings.prevId" @click="goTo(siblings.prevId)">
            <component :is="isRtl ? ChevronRight : ChevronLeft" class="size-4" />
          </Button>
          <Button variant="ghost" size="icon" type="button" :aria-label="t('tasks.detail.next')" :disabled="!siblings.nextId" @click="goTo(siblings.nextId)">
            <component :is="isRtl ? ChevronLeft : ChevronRight" class="size-4" />
          </Button>

          <DropdownMenu v-if="task?.allowed_actions.includes('archive')">
            <DropdownMenuTrigger as-child :disabled="!hydrated">
              <button
                type="button"
                data-testid="task-menu"
                class="inline-flex items-center rounded px-1 text-sm leading-none text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
                :disabled="!hydrated"
              >
                ⋯
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="task-archive" variant="destructive" @select="archiveConfirmOpen = true">
                {{ t('tasks.drawer.archive') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="icon" type="button" :aria-label="t('tasks.detail.close')" @click="emit('close')">
            <X class="size-4" />
          </Button>
        </div>
      </div>

      <div v-if="task" class="flex flex-wrap items-center gap-2">
        <StateMenu :task="task" :can-approve="task.can_approve" />
        <Badge v-if="task.project" variant="outline" class="max-w-full truncate">{{ task.project.name }}</Badge>
        <DeadlineBadge :deadline="task.date_deadline" :days-remaining="task.days_remaining" :is-closed="task.is_closed" />
      </div>
    </header>

    <div v-if="task && archiveConfirmOpen" data-testid="task-archive-confirm" class="space-y-2 border-b border-destructive/40 bg-destructive/5 p-3 text-sm">
      <p class="font-medium">{{ t('tasks.drawer.archive') }}</p>
      <p class="text-muted-foreground">{{ t('tasks.drawer.archiveConfirm') }}</p>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" type="button" :disabled="archiving" @click="archiveConfirmOpen = false">{{ t('app.cancel') }}</Button>
        <Button variant="destructive" type="button" :disabled="archiving" @click="doArchive">{{ t('tasks.drawer.archive') }}</Button>
      </div>
    </div>

    <div v-if="!task" class="flex flex-1 items-center justify-center p-4">
      <Skeleton class="h-40 w-full" />
    </div>

    <template v-else>
      <!--
        Only one layout is ever mounted at a time (gated on `isDesktop`,
        not a CSS breakpoint class): TaskDetails owns a live Tiptap editor
        and popover state, so mounting both the two-column and the tabbed
        layout simultaneously (one merely hidden via CSS) would run two
        live editors bound to the same field.
      -->
      <div v-if="isDesktop" class="grid flex-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_380px]">
        <div class="overflow-y-auto p-4">
          <TaskDetails :key="task.id" :task="task" />
        </div>
        <!--
          Unlike the details column, this one does not scroll itself:
          TaskActivity owns its own internal scroll region for the timeline
          so the composer can stay pinned at the foot of the column instead
          of scrolling away with it.
        -->
        <div class="overflow-hidden border-s">
          <TaskActivity :task="task" />
        </div>
      </div>

      <Tabs v-else default-value="details" class="flex flex-1 flex-col overflow-hidden">
        <TabsList class="mx-4 mt-2 w-fit">
          <TabsTrigger value="details">{{ t('tasks.drawer.details') }}</TabsTrigger>
          <TabsTrigger value="activity">{{ t('tasks.drawer.activity') }}</TabsTrigger>
        </TabsList>
        <TabsContent value="details" class="flex-1 overflow-y-auto p-4">
          <TaskDetails :key="task.id" :task="task" />
        </TabsContent>
        <!-- Same "TaskActivity owns its own scroll" reasoning as the md+ column above. -->
        <TabsContent value="activity" class="flex-1 overflow-hidden">
          <TaskActivity :task="task" />
        </TabsContent>
      </Tabs>
    </template>
  </div>
</template>
