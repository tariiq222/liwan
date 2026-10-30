<script setup lang="ts">
import type { Task, TaskState } from '@liwan/contracts'
import type { RouteLocationRaw } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import type { BoardStage, StageSource } from '@/composables/boardStages'
import { moveTo, stageOf } from '@/composables/boardStages'
import { STATE_LABEL_KEY, taskStateBadge } from '@/composables/taskState'
import { ApiError } from '@/composables/useApi'
import type { TaskListParams } from '@/composables/useTasks'
import { useTasks, useTransitionTask, useUpdateTask } from '@/composables/useTasks'
import { badgeLabel } from '@liwan/ui/app/utils/statusBadge'
import { usePersonalStages } from '@/composables/usePersonalStages'
import TaskCard from './TaskCard.vue'
import EmptyState from '@liwan/ui/app/components/shared/feedback/EmptyState.vue'

function isBoardCapped(loadedCount: number, cap: number, hasNextPage: boolean): boolean {
  return loadedCount > cap || (loadedCount >= cap && hasNextPage)
}

const props = withDefaults(defineProps<{
  params: TaskListParams
  stageSource?: StageSource
  // The create route for a column (the page adds its own return target); absent when the user cannot create tasks.
  cardTo: (id: number) => RouteLocationRaw
  createTo?: (column: { state?: TaskState; stageId?: number }) => RouteLocationRaw
}>(), {
  stageSource: () => ({ kind: 'personal' }),
  createTo: undefined,
})
const emit = defineEmits<{ open: [id: number] }>()

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const toast = useToast()

// Board cap: keep pulling pages until the list is exhausted or we've loaded
// 200 tasks, whichever comes first — a personal board isn't meant to hold
// thousands of cards, and this keeps the drag surface responsive.
const CAP = 200

const paramsRef = computed(() => props.params)
const { data, hasNextPage, fetchNextPage, isFetchingNextPage, isLoading, error, refetch } = useTasks(paramsRef)
const kind = computed(() => props.stageSource.kind)
const { data: stagesData, error: personalStagesError, isLoading: personalStagesLoading, refetch: refetchPersonalStages } = usePersonalStages()
const { mutate: updateTask } = useUpdateTask()
const { mutate: transitionTask } = useTransitionTask()

const allItems = computed<Task[]>(() => data.value?.pages.flatMap((page) => page.items) ?? [])

watchEffect(() => {
  if (!isLoading.value && hasNextPage.value && !isFetchingNextPage.value && allItems.value.length < CAP) {
    fetchNextPage()
  }
})

const isCapped = computed(() => isBoardCapped(allItems.value.length, CAP, hasNextPage.value))
const items = computed(() => allItems.value.slice(0, CAP))

const stageError = computed(() => kind.value === 'personal' ? personalStagesError.value : null)
const stageLoading = computed(() => kind.value === 'personal' && personalStagesLoading.value)
const sortedStages = computed<BoardStage[]>(() => {
  const src = props.stageSource.kind === 'project' ? props.stageSource.stages : (stagesData.value ?? [])
  return [...src].sort((a, b) => a.sequence - b.sequence || a.id - b.id)
})

const UNSTAGED = 'unstaged'

// Grouping lives in the URL (`?group=stage`) so a refresh, a shared link and the
// back button from a task keep it. Status is the default: every project and
// personal board has the same, always-populated columns, instead of one big
// "no stage" column for tasks nobody staged.
type Grouping = 'status' | 'stage'
const grouping = computed<Grouping>(() => (route.query.group === 'stage' ? 'stage' : 'status'))
function setGrouping(value: Grouping) {
  if (value === grouping.value) return
  void router.replace({ query: { ...route.query, group: value === 'stage' ? 'stage' : undefined } })
}
const groupingOptions = computed(() => [
  { value: 'status' as const, label: t('tasks.kanban.groupStatus') },
  { value: 'stage' as const, label: t('tasks.kanban.groupStage') },
])

// Status lanes follow the open/closed scope the list uses (the server returns only
// open tasks for the open scope, only done/cancelled for the closed one).
const OPEN_STATES: TaskState[] = ['in_progress', 'waiting', 'changes_requested', 'approved']
const CLOSED_STATES: TaskState[] = ['done', 'cancelled']
const statusLanes = computed<TaskState[]>(() => {
  const scope = props.params.closed ? CLOSED_STATES : OPEN_STATES
  const picked = props.params.state
  return picked?.length ? scope.filter((s) => picked.includes(s)) : scope
})

interface Lane {
  key: string
  title: string
  tone?: ReturnType<typeof taskStateBadge>['tone']
  stage?: BoardStage
  unstaged?: boolean
  state?: TaskState
}
const lanes = computed<Lane[]>(() => {
  if (grouping.value === 'status') {
    return statusLanes.value.map((state) => ({ key: state, title: t(STATE_LABEL_KEY[state]), tone: taskStateBadge(state).tone, state }))
  }
  const list: Lane[] = []
  // Leading "unstaged" lane: always on the personal board; on a project board only
  // when it holds cards (a project task always has a stage, so it can't take drops).
  if (kind.value === 'personal' || (columns.value[UNSTAGED]?.length ?? 0) > 0) {
    list.push({ key: UNSTAGED, title: t('tasks.kanban.unstaged'), unstaged: true })
  }
  for (const stage of sortedStages.value) list.push({ key: String(stage.id), title: stage.name, stage })
  return list
})

// Per-column arrays vue-draggable-plus mutates directly via v-model while
// dragging. Rebuilt from the query result on every change (including after
// an optimistic move settles the source task into its new column); dragging
// itself never writes back into `items`/query state, only into this map.
const columns = ref<Record<string, Task[]>>({})
function rebuildColumns() {
  const byKey: Record<string, Task[]> = {}
  if (grouping.value === 'status') {
    for (const state of statusLanes.value) byKey[state] = []
    for (const task of items.value) byKey[task.state]?.push(task)
  } else {
    byKey[UNSTAGED] = []
    for (const stage of sortedStages.value) byKey[String(stage.id)] = []
    for (const task of items.value) {
      const stage = stageOf(task, kind.value)
      ;(byKey[stage ? String(stage.id) : UNSTAGED] ??= []).push(task)
    }
  }
  columns.value = byKey
}
watch([items, sortedStages, grouping, statusLanes], rebuildColumns, { immediate: true })
const countOf = (key: string) => columns.value[key]?.length ?? 0

// Single move implementation shared by every way a task can change stage: a
// cross-column drag and the "..." menu on the card. `stage: null` targets the
// unstaged column (personal board only - a project task always has a stage, so
// moveTo returns null and this is a no-op).
function applyMove(task: Task, stage: BoardStage | null) {
  const move = moveTo(kind.value, stage)
  if (!move || !task.can_write) return
  if ((stageOf(task, kind.value)?.id ?? null) === (stage?.id ?? null)) return
  // The failure toast and the cache rollback come from useUpdateTask; the card is put back in its column.
  updateTask({ id: task.id, ...move }, { onError: rebuildColumns })
}

// A status change is a workflow transition, never optimistic: the server may refuse
// it, so a refused drop snaps the card back to the column the data still says it is in.
function applyTransition(task: Task, state: TaskState) {
  if (task.state === state) return
  if (!task.allowed_transitions?.includes(state)) {
    toast.add({ title: t('tasks.transition.forbidden'), color: 'error' })
    rebuildColumns()
    return
  }
  transitionTask({ id: task.id, state }, {
    onError: (err) => {
      toast.add({ title: err instanceof ApiError && err.code !== 'transition_forbidden' ? err.message : t('tasks.transition.forbidden'), color: 'error' })
      rebuildColumns()
    },
  })
}

// Fired only for real cross-column drops (SortableJS's @add via vue-draggable-plus),
// never for the programmatic v-model rebuild above. `event.data` is the underlying
// array item vue-draggable-plus resolves the dragged DOM node back to - the moved Task.
function onColumnAdd(event: { data?: Task }, lane: Lane) {
  const task = event.data
  if (!task) return
  if (lane.state) applyTransition(task, lane.state)
  else applyMove(task, lane.stage ?? null)
}

// The "..." menu on a card lists where it can go: its allowed transitions on a status
// board, the other stages on a stage board.
function moveTargets(task: Task) {
  if (grouping.value === 'status') {
    return (task.allowed_transitions ?? []).map((state) => ({ label: t(STATE_LABEL_KEY[state]), onSelect: () => applyTransition(task, state) }))
  }
  if (!task.can_write) return []
  const current = stageOf(task, kind.value)?.id ?? null
  return sortedStages.value.map((stage) => ({ label: stage.name, disabled: current === stage.id, onSelect: () => applyMove(task, stage) }))
}
const stateBadge = (state: TaskState) => { const entry = taskStateBadge(state); return { tone: entry.tone, label: badgeLabel(entry, state, t) } }

// Folded stages (fold: true) render collapsed by default; clicking a
// collapsed column expands it locally for the rest of the session.
const expandedFolded = ref(new Set<number>())
function toggleFold(stageId: number) {
  const next = new Set(expandedFolded.value)
  if (next.has(stageId)) next.delete(stageId)
  else next.add(stageId)
  expandedFolded.value = next
}
function isCollapsed(stage?: BoardStage): boolean {
  return !!stage?.fold && !expandedFolded.value.has(stage.id)
}
// A done or cancelled column cannot take a new task, so it has no '+'.
function laneCreateTo(lane: Lane): RouteLocationRaw | undefined {
  if (!props.createTo || lane.state === 'done' || lane.state === 'cancelled') return undefined
  return props.createTo({ state: lane.state, stageId: lane.stage?.id })
}
function dropGroup(lane: Lane) {
  return lane.unstaged && kind.value === 'project' ? { name: 'tasks', put: false } : 'tasks'
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2 p-4">
    <div class="flex flex-none flex-wrap items-center justify-between gap-2">
      <SharedSegmentedControl data-testid="board-grouping" :label="t('tasks.kanban.groupBy')" :items="groupingOptions" :model-value="grouping" @update:model-value="setGrouping($event as Grouping)" />
      <p v-if="isCapped" class="text-xs text-muted">{{ t('tasks.kanban.capped') }}</p>
    </div>
    <SharedPageState v-if="error" :error="error" @retry="refetch" />
    <SharedPageState v-else-if="stageError" :error="stageError" @retry="refetchPersonalStages" />
    <SharedPageState v-else-if="isLoading || stageLoading" loading />
    <!--
      The board fills the list card (SharedListCard `fill`, screen-sized): it scrolls horizontally, and each column
      scrolls vertically inside itself, so a column's header and drop target stay reachable whatever its card count.
    -->
    <div v-else class="liwan-board-scroll liwan-thin-scroll flex min-h-105 flex-1 items-stretch gap-3 overflow-x-auto pb-2">
      <template v-for="lane in lanes" :key="lane.key">
        <!-- Collapsed folded column: name + count, expands on click. -->
        <UButton
          v-if="isCollapsed(lane.stage)"
          type="button"
          color="neutral"
          variant="ghost"
          data-testid="board-column-folded"
          :data-stage-id="lane.key"
          :aria-expanded="false"
          :aria-label="t('tasks.kanban.expand', { name: lane.title })"
          class="flex w-12 shrink-0 flex-col items-center gap-2 rounded-card bg-elevated p-2 text-muted hover:bg-elevated"
          @click="toggleFold(lane.stage!.id)"
        >
          <span data-testid="board-column-count" class="text-xs font-medium">{{ countOf(lane.key) }}</span>
          <span class="text-xs [writing-mode:vertical-rl]">{{ lane.title }}</span>
        </UButton>

        <div
          v-else
          data-testid="board-column"
          :data-stage-id="lane.key"
          class="liwan-board-column flex w-[21.4286rem] shrink-0 flex-col gap-2.5 rounded-card bg-elevated p-2.5"
        >
          <div class="sticky top-0 z-10 flex items-center gap-2 px-1 pb-0.5">
            <UButton
              v-if="lane.stage?.fold"
              type="button"
              color="neutral"
              variant="ghost"
              data-testid="board-column-title"
              class="text-start text-sm font-medium hover:underline"
              :aria-expanded="true"
              :aria-label="t('tasks.kanban.collapse', { name: lane.title })"
              @click="toggleFold(lane.stage.id)"
            >
              {{ lane.title }}
            </UButton>
            <h3 v-else-if="lane.state" data-testid="board-column-title" class="text-sm font-medium"><SharedStatusBadge v-bind="stateBadge(lane.state)" /></h3>
            <h3 v-else data-testid="board-column-title" class="text-sm font-medium"><SharedStatusBadge tone="neutral" :label="lane.title" :class="lane.unstaged && 'text-muted'" /></h3>
            <span class="text-xs text-muted tabular-nums">{{ countOf(lane.key) }}</span>
            <UButton
              v-if="laneCreateTo(lane)"
              :to="laneCreateTo(lane)"
              square
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-plus"
              class="ms-auto size-8 rounded-full"
              data-testid="board-column-add"
              :data-stage-id="lane.key"
              :aria-label="t('tasks.kanban.addToColumn')"
              :title="t('tasks.kanban.addToColumn')"
            />
          </div>
          <!-- Sortable refuses to grab an item while its reorder timer is active. Keep reordering immediate so a
               card can be grabbed again at once, including with reduced motion; pointer tracking stays native. -->
          <VueDraggable
            v-model="columns[lane.key]!"
            class="liwan-thin-scroll flex min-h-16 flex-1 flex-col gap-2.5 overflow-y-auto max-md:max-h-[70svh]"
            :group="dropGroup(lane)"
            :animation="0"
            chosen-class="liwan-card-chosen"
            ghost-class="liwan-card-ghost"
            filter="[data-readonly=true]"
            @add="(e: any) => onColumnAdd(e, lane)"
          >
            <TaskCard
              v-for="task in columns[lane.key]"
              :key="task.id"
              :task="task"
              :to="cardTo(task.id)"
              :stages="sortedStages"
              :current-stage-id="stageOf(task, kind)?.id ?? null"
              :move-targets="moveTargets(task)"
              :show-project="kind === 'personal'"
              @open="emit('open', $event)"
            />
          </VueDraggable>
          <p v-if="countOf(lane.key) === 0" class="px-1 text-xs text-muted">{{ t('tasks.kanban.emptyColumn') }}</p>
        </div>
      </template>
    </div>
    <EmptyState
      v-if="grouping === 'stage' && kind === 'project' && sortedStages.length === 0"
      :title="t('tasks.kanban.noStages')"
      class="py-6"
    />
  </div>
</template>
