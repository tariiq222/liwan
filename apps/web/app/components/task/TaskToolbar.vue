<script setup lang="ts">
import type { TaskState } from '@nasq/contracts'
import { Plus, Search } from 'lucide-vue-next'
import { refDebounced } from '@vueuse/core'
import type { TaskListParams } from '@/composables/useTasks'
import { STATE_LABEL_KEY } from '@/composables/taskState'
import { useProjects } from '@/composables/useProjects'

const props = defineProps<{ modelValue: TaskListParams; hideProjectFilter?: boolean; hideCreate?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [TaskListParams]; create: [] }>()
const { t } = useI18n()
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
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Tabs
      :model-value="modelValue.closed ? 'closed' : 'open'"
      @update:model-value="(v) => patch({ closed: v === 'closed' })"
    >
      <TabsList>
        <TabsTrigger value="open" :disabled="!hydrated">{{ t('tasks.filters.open') }}</TabsTrigger>
        <TabsTrigger value="closed" :disabled="!hydrated">{{ t('tasks.filters.closed') }}</TabsTrigger>
      </TabsList>
    </Tabs>

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

    <div class="relative min-w-48 flex-1">
      <Search class="pointer-events-none absolute start-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input v-model="search" :disabled="!hydrated" :placeholder="t('tasks.filters.search')" class="ps-8" />
    </div>

    <Button v-if="!hideCreate" size="sm" class="gap-1.5" :disabled="!hydrated" @click="emit('create')">
      <Plus class="size-4" />{{ t('tasks.new') }}
    </Button>
  </div>
</template>
