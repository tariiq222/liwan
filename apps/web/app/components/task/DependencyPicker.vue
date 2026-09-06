<script setup lang="ts">
import { Check, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { TaskDetail } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useTaskDependencies, useTaskDependencyCandidates, useUpdateTaskDependencies } from '@/composables/useTaskDependencies'

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
  <section v-if="task.can_manage_dependencies" class="space-y-2" data-testid="dependency-picker">
    <Label>{{ t('taskLifecycle.dependencies') }}</Label>
    <div class="flex flex-wrap gap-1">
      <Badge v-for="dep in dependencies" :key="dep.id" variant="outline" class="gap-1 pe-1">
        {{ dep.name }}
        <button type="button" :aria-label="t('taskLifecycle.removeDependency')" :disabled="!hydrated || isPending" @click="remove(dep.id)">
          <X class="size-3" />
        </button>
      </Badge>
      <span v-if="!dependencies.length" class="text-sm text-muted-foreground">—</span>
    </div>
    <Popover v-model:open="open">
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
  </section>
</template>

