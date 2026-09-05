<script setup lang="ts">
import type { Task } from '@nasq/contracts'
import { VueDraggable } from 'vue-draggable-plus'
import type { BoardStage, StageSource } from '@/composables/boardStages'
import { moveTo, stageOf } from '@/composables/boardStages'
import type { TaskListParams } from '@/composables/useTasks'
import { useUpdateTask, useTasks } from '@/composables/useTasks'
import { usePersonalStages } from '@/composables/usePersonalStages'
import TaskCard from './TaskCard.vue'

const props = withDefaults(defineProps<{ params: TaskListParams; stageSource?: StageSource }>(), {
  stageSource: () => ({ kind: 'personal' }),
})
const emit = defineEmits<{ open: [id: number] }>()

const { t } = useI18n()

// Board cap: keep pulling pages until the list is exhausted or we've loaded
// 200 tasks, whichever comes first — a personal board isn't meant to hold
// thousands of cards, and this keeps the drag surface responsive.
const CAP = 200

const paramsRef = computed(() => props.params)
const { data, hasNextPage, fetchNextPage, isFetchingNextPage, isLoading } = useTasks(paramsRef)
const { data: stagesData } = usePersonalStages()
const { mutate: updateTask } = useUpdateTask()

const allItems = computed<Task[]>(() => data.value?.pages.flatMap((page) => page.items) ?? [])

watchEffect(() => {
  if (!isLoading.value && hasNextPage.value && !isFetchingNextPage.value && allItems.value.length < CAP) {
    fetchNextPage()
  }
})

const isCapped = computed(() => allItems.value.length >= CAP && hasNextPage.value === true)
const items = computed(() => allItems.value.slice(0, CAP))

const kind = computed(() => props.stageSource.kind)
const sortedStages = computed<BoardStage[]>(() => {
  const src = props.stageSource.kind === 'project' ? props.stageSource.stages : (stagesData.value ?? [])
  return [...src].sort((a, b) => a.sequence - b.sequence || a.id - b.id)
})

const UNSTAGED = 'unstaged'

// Per-column arrays vue-draggable-plus mutates directly via v-model while
// dragging. Rebuilt from the query result on every change (including after
// an optimistic move settles the source task into its new column); dragging
// itself never writes back into `items`/query state, only into this map.
const columns = ref<Record<string, Task[]>>({})
watch(
  [items, sortedStages],
  ([tasks, stages]) => {
    const byStage: Record<string, Task[]> = { [UNSTAGED]: [] }
    for (const stage of stages) byStage[String(stage.id)] = []
    for (const task of tasks) {
      const stage = stageOf(task, kind.value)
      const key = stage ? String(stage.id) : UNSTAGED
      ;(byStage[key] ??= []).push(task)
    }
    columns.value = byStage
  },
  { immediate: true },
)

// Single move implementation shared by every way a task can change stage: a
// cross-column drag (onColumnAdd below, for both a real stage and the
// unstaged column) and the "..." menu on the card (@move in the template).
// `stage: null` targets the unstaged column (personal board only — a
// project task always has a stage, so moveTo returns null and this is a
// no-op).
function applyMove(task: Task, stage: BoardStage | null) {
  const move = moveTo(kind.value, stage)
  if (!move || !task.can_write) return
  if ((stageOf(task, kind.value)?.id ?? null) === (stage?.id ?? null)) return
  updateTask({ id: task.id, ...move })
}

// Fired only for real cross-column drops (SortableJS's @add via
// vue-draggable-plus), never for the programmatic v-model rebuild above.
// `event.data` is the underlying array item vue-draggable-plus resolves the
// dragged DOM node back to — the moved Task itself.
function onColumnAdd(event: { data?: Task }, targetKey: string) {
  const task = event.data
  if (!task) return
  if (targetKey === UNSTAGED) {
    applyMove(task, null)
    return
  }
  const stage = sortedStages.value.find((s) => String(s.id) === targetKey)
  if (stage) applyMove(task, stage)
}

// Folded stages (fold: true) render collapsed by default; clicking a
// collapsed column expands it locally for the rest of the session.
const expandedFolded = ref(new Set<number>())
function toggleFold(stageId: number) {
  const next = new Set(expandedFolded.value)
  if (next.has(stageId)) next.delete(stageId)
  else next.add(stageId)
  expandedFolded.value = next
}
function isCollapsed(stage: BoardStage): boolean {
  return stage.fold && !expandedFolded.value.has(stage.id)
}
</script>

<template>
  <div class="space-y-2">
    <p v-if="isCapped" class="text-xs text-muted-foreground">{{ t('tasks.kanban.capped') }}</p>
    <!--
      A fixed board height with per-column vertical scroll (rather than
      letting the whole page grow with the tallest column) keeps every
      column's header and drop target reachable regardless of how many
      cards a stage holds — the board only scrolls horizontally, per spec.
    -->
    <div class="flex h-[calc(100vh-260px)] min-h-[420px] items-start gap-3 overflow-x-auto pb-2">
      <!-- Leading "unstaged" column: tasks with no stage yet. Always shown on
           the personal board; on a project board only when it actually holds
           cards, since a project task always has a stage and the column
           can't accept drops there. -->
      <div
        v-if="kind === 'personal' || (columns[UNSTAGED]?.length ?? 0) > 0"
        data-testid="board-column"
        data-stage-id="unstaged"
        class="flex h-full w-72 shrink-0 flex-col gap-2 rounded-lg border bg-muted/30 p-2"
      >
        <div class="flex items-center justify-between px-1">
          <h3 data-testid="board-column-title" class="text-sm font-medium text-muted-foreground">{{ t('tasks.kanban.unstaged') }}</h3>
          <span class="text-xs text-muted-foreground">{{ columns[UNSTAGED]?.length ?? 0 }}</span>
        </div>
        <VueDraggable
          v-model="columns[UNSTAGED]!"
          class="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto"
          :group="kind === 'project' ? { name: 'tasks', put: false } : 'tasks'"
          :animation="150"
          filter="[data-readonly=true]"
          @add="(e: any) => onColumnAdd(e, UNSTAGED)"
        >
          <TaskCard
            v-for="task in columns[UNSTAGED]"
            :key="task.id"
            :task="task"
            :stages="sortedStages"
            :current-stage-id="stageOf(task, kind)?.id ?? null"
            :show-project="kind === 'personal'"
            @open="emit('open', $event)"
            @move="applyMove(task, $event)"
          />
        </VueDraggable>
        <p v-if="(columns[UNSTAGED]?.length ?? 0) === 0" class="px-1 text-xs text-muted-foreground">{{ t('tasks.kanban.emptyColumn') }}</p>
      </div>

      <template v-for="stage in sortedStages" :key="stage.id">
        <!-- Collapsed folded column: name + count, expands on click. -->
        <button
          v-if="isCollapsed(stage)"
          type="button"
          data-testid="board-column-folded"
          :data-stage-id="stage.id"
          class="flex h-full w-12 shrink-0 flex-col items-center gap-2 rounded-lg border bg-muted/30 p-2 text-muted-foreground hover:bg-muted"
          @click="toggleFold(stage.id)"
        >
          <span data-testid="board-column-count" class="text-xs font-medium">{{ columns[String(stage.id)]?.length ?? 0 }}</span>
          <span class="text-xs [writing-mode:vertical-rl]">{{ stage.name }}</span>
        </button>

        <div
          v-else
          data-testid="board-column"
          :data-stage-id="stage.id"
          class="flex h-full w-72 shrink-0 flex-col gap-2 rounded-lg border bg-muted/30 p-2"
        >
          <div class="flex items-center justify-between px-1">
            <h3
              data-testid="board-column-title"
              class="cursor-pointer text-sm font-medium"
              :class="{ 'hover:underline': stage.fold }"
              @click="stage.fold && toggleFold(stage.id)"
            >
              {{ stage.name }}
            </h3>
            <span class="text-xs text-muted-foreground">{{ columns[String(stage.id)]?.length ?? 0 }}</span>
          </div>
          <VueDraggable
            v-model="columns[String(stage.id)]!"
            class="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto"
            group="tasks"
            :animation="150"
          filter="[data-readonly=true]"
            @add="(e: any) => onColumnAdd(e, String(stage.id))"
          >
            <TaskCard
              v-for="task in columns[String(stage.id)]"
              :key="task.id"
              :task="task"
              :stages="sortedStages"
              :current-stage-id="stageOf(task, kind)?.id ?? null"
              :show-project="kind === 'personal'"
              @open="emit('open', $event)"
              @move="applyMove(task, $event)"
            />
          </VueDraggable>
          <p v-if="(columns[String(stage.id)]?.length ?? 0) === 0" class="px-1 text-xs text-muted-foreground">
            {{ t('tasks.kanban.emptyColumn') }}
          </p>
        </div>
      </template>
    </div>
    <p v-if="kind === 'project' && sortedStages.length === 0" class="text-sm text-muted-foreground">{{ t('tasks.kanban.noStages') }}</p>
  </div>
</template>
