<script setup lang="ts">
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { useTaskFilters } from '@/composables/useTaskFilters'
import type { TaskListParams } from '@/composables/useTasks'
import { useTask, useTaskSiblings, useUpdateTask } from '@/composables/useTasks'
import DeadlineBadge from './DeadlineBadge.vue'
import StateMenu from './StateMenu.vue'
import TaskActivity from './TaskActivity.vue'
import TaskDetails from './TaskDetails.vue'

// Container-agnostic body: header (title, state, project chip, deadline
// badge, prev/next, close) + the two-column (details/activity) layout. The
// Dialog wrapper lives in TaskDetailModal.vue so a later split-view host can
// reuse this without depending on Dialog internals.
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
// behind this modal rather than whichever list happened to be cached first.
// Decided once per instance: the two branches are different composables.
const localFilters = props.siblingParams ? null : useTaskFilters()
const filterParams = computed<TaskListParams>(() => props.siblingParams ?? localFilters!.value)
const siblings = useTaskSiblings(idRef, filterParams)
const { mutate: updateTask } = useUpdateTask()

const titleDraft = ref('')
watch(
  () => task.value?.name,
  (name) => {
    if (name !== undefined) titleDraft.value = name
  },
  { immediate: true },
)

function saveTitle() {
  if (!task.value) return
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
  if (e.key === 'j' || e.key === 'J') goTo(siblings.value.nextId)
  else if (e.key === 'k' || e.key === 'K') goTo(siblings.value.prevId)
}

useEventListener(document, 'keydown', onKeydown)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <header class="flex items-center gap-3 border-b p-4">
      <Input
        v-if="task"
        v-model="titleDraft"
        :aria-label="t('tasks.newTitle')"
        class="h-9 flex-1 border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
        @blur="saveTitle"
      />
      <Skeleton v-else class="h-7 flex-1" />

      <template v-if="task">
        <StateMenu :task="task" :can-approve="task.can_approve" />
        <Badge v-if="task.project" variant="outline">{{ task.project.name }}</Badge>
        <DeadlineBadge :deadline="task.date_deadline" :days-remaining="task.days_remaining" :is-closed="task.is_closed" />
      </template>

      <div class="flex items-center gap-1">
        <Button variant="ghost" size="icon" type="button" :aria-label="t('tasks.detail.prev')" :disabled="!siblings.prevId" @click="goTo(siblings.prevId)">
          <component :is="isRtl ? ChevronRight : ChevronLeft" class="size-4" />
        </Button>
        <Button variant="ghost" size="icon" type="button" :aria-label="t('tasks.detail.next')" :disabled="!siblings.nextId" @click="goTo(siblings.nextId)">
          <component :is="isRtl ? ChevronLeft : ChevronRight" class="size-4" />
        </Button>
        <Button variant="ghost" size="icon" type="button" :aria-label="t('tasks.detail.close')" @click="emit('close')">
          <X class="size-4" />
        </Button>
      </div>
    </header>

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
