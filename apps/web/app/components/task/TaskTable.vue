<script setup lang="ts">
import type { Task } from '@nasq/contracts'
import { UAvatar, UButton } from '#components'
import { createColumnHelper } from '@tanstack/vue-table'
import { h } from 'vue'
import type { TaskListParams } from '@/composables/useTasks'
import { useTasks } from '@/composables/useTasks'
import DeadlineBadge from './DeadlineBadge.vue'
import PrioritySelect from './PrioritySelect.vue'
import StateMenu from './StateMenu.vue'
import EmptyState from '@/components/shared/EmptyState.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'

const props = withDefaults(defineProps<{ params: TaskListParams; variant?: 'mine' | 'project'; embedded?: boolean }>(), { variant: 'mine', embedded: false })
const emit = defineEmits<{
  open: [id: number]
  create: []
}>()

const { t } = useI18n()
const { can } = useAccess()
// Rows (and the row-open click handler, "load more", and the empty state's
// "create" action) can be SSR-rendered with data already available, making
// them clickable before Nuxt hydrates and attaches listeners — the same
// race documented in README's "SSR hydration and interactive controls".
// The per-cell StateMenu/PrioritySelect controls gate themselves.
const hydrated = useHydrated()

const paramsRef = computed(() => props.params)
const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage, error, refetch } = useTasks(paramsRef)

const items = computed<Task[]>(() => data.value?.pages.flatMap((page) => page.items) ?? [])
// A search/state/project filter yielding zero rows is a different situation
// from genuinely having no tasks — the empty state (with a "create" action)
// only makes sense when nothing is filtered out. `closed` is a tab, not a
// filter in that sense, but an empty closed tab still isn't "no tasks
// assigned to you" (that copy — and its create action — belongs to the open
// tab only) so it gets its own message and no create action.
const hasActiveFilters = computed(
  () => !!props.params.q || (props.variant === 'mine' && !!props.params.project_id) || !!props.params.state?.length,
)
const emptyTitleKey = computed(() => {
  if (hasActiveFilters.value) return 'app.noResults'
  return props.params.closed ? 'tasks.empty.closedTitle' : 'tasks.empty.title'
})
const showCreateAction = computed(() => can('pmo.tasks.create') && !hasActiveFilters.value && !props.params.closed)

const columnHelper = createColumnHelper<Task>()
const recordNumberColumn = columnHelper.display({
  id: 'record_number',
  header: () => t('app.recordNumber'),
  cell: (info) => h(RecordNumber, { value: info.row.original.id }),
})
const titleColumn = columnHelper.display({
  id: 'title',
  header: () => t('tasks.columns.title'),
  cell: (info) => h(UButton, {
    type: 'button',
    color: 'neutral',
    variant: 'link',
    class: 'block max-w-full truncate p-0 text-start font-medium',
    disabled: !hydrated.value,
    onClick: (event: MouseEvent) => { event.stopPropagation(); if (hydrated.value) emit('open', info.row.original.id) },
  }, () => info.row.original.name),
})
const projectColumn = columnHelper.display({
  id: 'project',
  header: () => t('tasks.columns.project'),
  cell: (info) => info.row.original.project?.name ?? '—',
})
// Interactive cell controls (dropdown/select triggers) must not also open the
// row; stopping propagation here is more robust than sniffing ancestor
// selectors against a UI library's internal markup.
function stopRowOpen(node: ReturnType<typeof h>) {
  return h('span', { onClick: (e: MouseEvent) => e.stopPropagation() }, [node])
}
const stateColumn = columnHelper.display({
  id: 'state',
  header: () => t('tasks.columns.state'),
  cell: (info) => stopRowOpen(h(StateMenu, { task: info.row.original })),
})
const deadlineColumn = columnHelper.display({
  id: 'deadline',
  header: () => t('tasks.columns.deadline'),
  cell: (info) =>
    h(DeadlineBadge, {
      deadline: info.row.original.date_deadline,
      daysRemaining: info.row.original.days_remaining,
      isClosed: info.row.original.is_closed,
    }),
})
const priorityColumn = columnHelper.display({
  id: 'priority',
  header: () => t('tasks.columns.priority'),
  cell: (info) => stopRowOpen(h(PrioritySelect, { task: info.row.original })),
})
const personalStageColumn = columnHelper.display({
  id: 'stage',
  header: () => t('tasks.columns.stage'),
  cell: (info) => info.row.original.personal_stage?.name ?? '—',
})
const projectStageColumn = columnHelper.display({
  id: 'stage',
  header: () => t('tasks.columns.stage'),
  cell: (info) => info.row.original.stage?.name ?? '—',
})
// Same short-initials rule as TaskCard/Timeline: first letter of up to two words.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length ? parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') : '?'
}
const assigneesColumn = columnHelper.display({
  id: 'assignees',
  header: () => t('tasks.columns.assignees'),
  cell: (info) => {
    const people = info.row.original.assignees
    if (!people.length) return h('span', { class: 'text-muted' }, '—')
    return h('span', { class: 'inline-flex min-w-0 max-w-full items-center gap-2' }, [
      h(UAvatar, { text: initials(people[0]!.name), size: 'xs', class: 'shrink-0 bg-brand-soft text-brand-link' }),
      h('span', { class: 'truncate' }, people.map((a) => a.name).join('، ')),
    ])
  },
})

const columns = computed(() =>
  props.variant === 'project'
    ? [recordNumberColumn, titleColumn, assigneesColumn, projectStageColumn, deadlineColumn, priorityColumn, stateColumn]
    : [recordNumberColumn, titleColumn, projectColumn, stateColumn, deadlineColumn, priorityColumn, personalStageColumn],
)

const columnWidths = computed(() =>
  props.variant === 'project'
    ? ['w-[6%]', 'w-[30%]', 'w-[12%]', 'w-[12%]', 'w-[12%]', 'w-[14%]', 'w-[14%]']
    : ['w-[7%]', 'w-[30%]', 'w-[14%]', 'w-[14%]', 'w-[13%]', 'w-[12%]', 'w-[10%]'],
)

// Keep the number and title columns stable while preserving the row's
// click-to-open behavior; widths are applied to both the header and cell.
const tableColumns = computed(() => columns.value.map((col, i) => ({
  ...col,
  meta: { class: { th: `text-start ${columnWidths.value[i] ?? ''}`, td: `max-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${columnWidths.value[i] ?? ''}` } },
})))

function onRowSelect(_event: Event, row: { original: Task }) {
  if (!hydrated.value) return
  emit('open', row.original.id)
}

// The state/priority cells are interactive controls of their own (dropdown
// trigger, select trigger); a click that lands on one of them must not also
// open the row.
function onRowClick(task: Task, event: MouseEvent) {
  if (!hydrated.value) return
  const target = event.target as HTMLElement
  if (target.closest('button, [role="combobox"]')) return
  emit('open', task.id)
}
</script>

<template>
  <div :class="embedded ? 'space-y-0' : 'space-y-2'">
    <div :class="embedded ? '' : 'nasq-ui-record-surface'">
      <div class="hidden overflow-x-auto md:block">
        <SharedPageState v-if="error" :error="error" @retry="refetch" />
        <EmptyState v-else-if="!isLoading && items.length === 0" :title="t(emptyTitleKey)">
          <template v-if="showCreateAction" #action>
            <UButton size="sm" :disabled="!hydrated" @click="emit('create')">{{ t('tasks.empty.action') }}</UButton>
          </template>
        </EmptyState>
        <UTable
          v-else
          class="table-fixed"
          :class="variant === 'project' ? 'min-w-[960px]' : 'min-w-[760px]'"
          :data="items"
          :columns="tableColumns"
          :loading="isLoading"
          :ui="{ tr: 'cursor-pointer' }"
          @select="onRowSelect"
        />
      </div>

      <div class="divide-y divide-default md:hidden">
        <template v-if="isLoading">
          <div v-for="n in 5" :key="`mobile-skeleton-${n}`" class="space-y-2 p-3">
            <USkeleton class="h-5 w-4/5" />
            <USkeleton class="h-4 w-2/5" />
            <div class="flex gap-2"><USkeleton class="h-6 w-20" /><USkeleton class="h-6 w-20" /></div>
          </div>
        </template>
        <div v-else-if="error" class="p-6 text-center">
          <SharedPageState :error="error" @retry="refetch" />
        </div>
        <div v-else-if="items.length === 0" class="p-6 text-center">
          <EmptyState :title="t(emptyTitleKey)">
            <template v-if="showCreateAction" #action>
              <UButton size="sm" :disabled="!hydrated" @click="emit('create')">
                {{ t('tasks.empty.action') }}
              </UButton>
            </template>
          </EmptyState>
        </div>
        <template v-else>
          <article
            v-for="task in items"
            :key="`mobile-${task.id}`"
            class="space-y-2 p-3"
            :class="hydrated ? 'cursor-pointer active:bg-elevated/50' : ''"
            @click="onRowClick(task, $event)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <RecordNumber :value="task.id" />
                <UButton type="button" color="neutral" variant="link" class="block min-w-0 max-w-full justify-start truncate p-0 text-start font-medium text-highlighted" :disabled="!hydrated" @click.stop="emit('open', task.id)">{{ task.name }}</UButton>
              </div>
              <DeadlineBadge
                class="shrink-0"
                :deadline="task.date_deadline"
                :days-remaining="task.days_remaining"
                :is-closed="task.is_closed"
              />
            </div>
            <p class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span class="truncate">{{ task.project?.name ?? (props.variant === 'project' ? task.stage?.name : '—') }}</span>
              <span v-if="props.variant === 'project' && task.stage && task.project" aria-hidden="true">·</span>
              <span v-if="props.variant === 'project' && task.stage && task.project" class="truncate">{{ task.stage.name }}</span>
              <span v-else-if="props.variant !== 'project' && task.personal_stage" aria-hidden="true">·</span>
              <span v-if="props.variant !== 'project' && task.personal_stage" class="truncate">{{ task.personal_stage.name }}</span>
              <span v-if="task.assignees.length" aria-hidden="true">·</span>
              <span v-if="task.assignees.length" class="truncate">{{ task.assignees.map((a) => a.name).join('، ') }}</span>
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <StateMenu :task="task" />
              <PrioritySelect :task="task" />
            </div>
          </article>
        </template>
      </div>
    </div>
    <div v-if="hasNextPage" class="flex justify-center">
      <UButton color="neutral" variant="outline" size="sm" :disabled="isFetchingNextPage || !hydrated" @click="fetchNextPage()">
        {{ t('app.loadMore') }}
      </UButton>
    </div>
  </div>
</template>
