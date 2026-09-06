<script setup lang="ts">
import type { TaskState } from '@nasq/contracts'
import { LayoutGrid, List, Plus, Search, X } from '@lucide/vue'
import { refDebounced } from '@vueuse/core'
import type { TaskListParams } from '@/composables/useTasks'
import { STATE_LABEL_KEY } from '@/composables/taskState'
import { useProjects } from '@/composables/useProjects'
import FilterBar from '@/components/shared/FilterBar.vue'

const props = defineProps<{ modelValue: TaskListParams; hideProjectFilter?: boolean; hideCreate?: boolean; view?: 'table' | 'board'; embedded?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [TaskListParams]; 'update:view': ['table' | 'board']; create: [] }>()
const { t } = useI18n()
const { can } = useAccess()
// Every control below is SSR-rendered and visible/clickable before Nuxt
// hydrates and attaches its listeners; an interaction in that window is
// silently dropped (see useHydrated()). Disable them all until hydration
// completes — the tab triggers, the state/project filter triggers, the
// search input, and the "new task" button all have JS listeners and are
// racy in the exact same way.
const hydrated = useHydrated()

const { data: projects } = useProjects()

const ALL_STATES: TaskState[] = ['in_progress', 'waiting', 'changes_requested', 'approved', 'done', 'cancelled']

function patch(changes: Partial<TaskListParams>) {
  emit('update:modelValue', { ...props.modelValue, ...changes })
}

const selectedStates = computed(() => props.modelValue.state ?? [])
const selectedProject = computed(() => (projects.value ?? []).find((project) => project.id === props.modelValue.project_id) ?? null)
function toggleState(s: TaskState, checked: boolean) {
  const next = new Set(selectedStates.value)
  if (checked) next.add(s)
  else next.delete(s)
  patch({ state: next.size ? [...next] : undefined })
}

// The debounce is about the network request, not the input's responsiveness:
// `search` updates every keystroke for a snappy field, while `debouncedSearch`
// (and therefore `modelValue.q`) only settles 300ms after typing stops.
const search = ref(props.modelValue.q ?? '')
const debouncedSearch = refDebounced(search, 300)
watch(debouncedSearch, (q) => patch({ q: q || undefined }))
// If params are reset from elsewhere (e.g. restored from localStorage after
// this component mounted), keep the visible input in sync.
watch(
  () => props.modelValue.q,
  (q) => {
    if ((q ?? '') !== search.value) search.value = q ?? ''
  },
)

function clearFilters() {
  search.value = ''
  patch({ q: undefined, state: undefined, project_id: props.hideProjectFilter ? props.modelValue.project_id : undefined })
}
</script>

<template>
  <div :class="embedded ? 'nasq-toolbar rounded-none border-x-0 border-t-0 bg-muted/30' : 'nasq-toolbar'">
  <FilterBar class="w-full">
    <template #search>
      <div class="relative min-w-48 flex-1">
        <Search class="pointer-events-none absolute start-2 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
        <Input v-model="search" :disabled="!hydrated" :placeholder="t('tasks.filters.search')" class="ps-8" />
      </div>
    </template>

    <template #default>
      <DropdownMenu>
        <DropdownMenuTrigger as-child :disabled="!hydrated">
          <Button variant="outline" size="sm" :disabled="!hydrated">{{ t('tasks.filters.allStates') }}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuCheckboxItem
            v-for="s in ALL_STATES"
            :key="s"
            :model-value="selectedStates.includes(s)"
            @select.prevent
            @update:model-value="(checked) => toggleState(s, checked)"
          >
            {{ t(STATE_LABEL_KEY[s]) }}
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <template v-if="!hideProjectFilter">
        <Select
          :model-value="modelValue.project_id ? String(modelValue.project_id) : 'all'"
          @update:model-value="(v) => patch({ project_id: v === 'all' ? undefined : Number(v) })"
        >
          <SelectTrigger size="sm" class="w-40" :disabled="!hydrated">
            <SelectValue :placeholder="t('tasks.filters.allProjects')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t('tasks.filters.allProjects') }}</SelectItem>
            <SelectItem v-for="p in projects ?? []" :key="p.id" :value="String(p.id)">{{ p.name }}</SelectItem>
          </SelectContent>
        </Select>
      </template>

      <Button v-if="!hideCreate && can('pmo.tasks.create')" size="sm" class="gap-1.5" :disabled="!hydrated" @click="emit('create')">
        <Plus class="size-[18px]" />{{ t('tasks.new') }}
      </Button>
    </template>

    <template #active>
      <div v-if="modelValue.q || selectedStates.length || (!hideProjectFilter && selectedProject)" class="flex flex-wrap items-center gap-2">
        <Badge v-if="modelValue.q" variant="secondary">{{ t('tasks.filters.searchValue', { value: modelValue.q }) }}</Badge>
        <Badge v-for="state in selectedStates" :key="state" variant="secondary">{{ t(STATE_LABEL_KEY[state]) }}</Badge>
        <Badge v-if="!hideProjectFilter && selectedProject" variant="secondary">{{ selectedProject.name }}</Badge>
        <Button variant="ghost" size="sm" class="gap-1" :disabled="!hydrated" @click="clearFilters">
          <X class="size-3.5" />{{ t('tasks.filters.clear') }}
        </Button>
      </div>
    </template>

    <template #view>
      <div v-if="view" role="group" class="inline-flex h-[40px] items-center rounded-lg border bg-background p-0.5" :aria-label="t('projects.filters.view')">
        <Button data-testid="project-tasks-view-table" type="button" variant="ghost" size="icon" class="size-[32px] rounded-md" :class="view === 'table' ? 'bg-muted shadow-sm' : ''" :disabled="!hydrated" :aria-label="t('projects.filters.tableView')" :aria-pressed="view === 'table'" @click="emit('update:view', 'table')">
          <List class="size-[18px]" />
        </Button>
        <Button data-testid="project-tasks-view-board" type="button" variant="ghost" size="icon" class="size-[32px] rounded-md" :class="view === 'board' ? 'bg-muted shadow-sm' : ''" :disabled="!hydrated" :aria-label="t('projects.filters.boardView')" :aria-pressed="view === 'board'" @click="emit('update:view', 'board')">
          <LayoutGrid class="size-[18px]" />
        </Button>
      </div>
      <Tabs
        :model-value="modelValue.closed ? 'closed' : 'open'"
        @update:model-value="(v) => patch({ closed: v === 'closed' })"
      >
        <TabsList>
          <TabsTrigger value="open" :disabled="!hydrated">{{ t('tasks.filters.open') }}</TabsTrigger>
          <TabsTrigger value="closed" :disabled="!hydrated">{{ t('tasks.filters.closed') }}</TabsTrigger>
        </TabsList>
      </Tabs>
    </template>
  </FilterBar>
  </div>
</template>
