<script setup lang="ts">
import { Check, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { TaskDetail } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useTaskDependencies, useTaskDependencyCandidates, useUpdateTaskDependencies } from '@/composables/useTaskDependencies'
import StateBadge from './StateBadge.vue'

const props = defineProps<{ task: TaskDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const open = ref(false)
const q = ref('')
const taskId = computed(() => props.task.id)
const { data: dependencyState } = useTaskDependencies(taskId)
const { data: candidates, hasNextPage, fetchNextPage, isFetchingNextPage } = useTaskDependencyCandidates(taskId, q)
const { mutate: update, isPending } = useUpdateTaskDependencies()

const dependencies = computed(() => dependencyState.value?.items ?? props.task.depends_on)
const selected = computed(() => new Set(dependencies.value.map((d) => d.id)))
const available = computed(() => (candidates.value?.pages ?? []).flatMap((page) => page.items))

function commit(ids: number[]) {
  update({ id: props.task.id, ids }, { onError: (error) => toast.error(error instanceof ApiError ? error.message : t('errors.generic')) })
}
function toggle(id: number) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  commit([...next])
}
function remove(id: number) {
  commit([...selected.value].filter((value) => value !== id))
}
</script>

<template>
  <section class="nasq-panel" data-testid="dependency-picker">
    <header class="nasq-panel-header">
      <h2>{{ t('taskLifecycle.dependencies') }} <span class="text-xs font-normal text-muted-foreground">{{ dependencies.length }}</span></h2>
      <Popover v-if="task.can_manage_dependencies" v-model:open="open">
        <PopoverTrigger as-child>
          <Button variant="outline" size="sm" type="button" :disabled="!hydrated || isPending || !dependencyState?.enabled">{{ t('taskLifecycle.addDependency') }}</Button>
        </PopoverTrigger>
        <PopoverContent class="w-72 p-0" align="start">
          <div class="border-b p-2">
            <Input v-model="q" :placeholder="t('app.search')" class="h-8" />
          </div>
          <Command>
            <CommandList>
              <CommandEmpty>{{ t('taskLifecycle.noCandidates') }}</CommandEmpty>
              <CommandGroup>
                <CommandItem v-for="candidate in available" :key="candidate.id" :value="String(candidate.id)" :disabled="isPending" @select="toggle(candidate.id)">
                  <span class="flex-1 truncate">{{ candidate.name }}</span>
                  <Check v-if="selected.has(candidate.id)" class="size-4" />
                </CommandItem>
                <Button v-if="hasNextPage" variant="ghost" size="sm" class="m-2 w-[calc(100%-1rem)]" :disabled="isFetchingNextPage" @click="fetchNextPage()">
                  {{ t('taskLifecycle.loadMore') }}
                </Button>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </header>

    <div class="nasq-panel-body">
      <ul v-if="dependencies.length" class="task-list">
        <li v-for="dep in dependencies" :key="dep.id" class="task-dependency-row">
          <StateBadge :state="dep.state" />
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ dep.name }}</span>
          <Button
            v-if="task.can_manage_dependencies"
            variant="ghost"
            size="icon"
            type="button"
            :aria-label="t('taskLifecycle.removeDependency')"
            :disabled="!hydrated || isPending"
            @click="remove(dep.id)"
          >
            <X class="size-[18px]" />
          </Button>
        </li>
      </ul>
      <p v-else class="task-empty-inline">{{ t('tasks.detail.noDependencies') }}</p>
    </div>
  </section>
</template>

<style scoped>
.task-list {
  display: grid;
  gap: 4px;
}

.task-dependency-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 3px;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.task-dependency-row:hover {
  border-color: var(--border);
  background: var(--muted);
}

.task-dependency-row:focus-within {
  border-color: var(--ring);
}

.task-empty-inline {
  padding: 10px 0;
  color: var(--muted-foreground);
  font-size: 0.75rem;
}
</style>
