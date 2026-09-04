<script setup lang="ts">
import type { Task } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import { Check, X } from 'lucide-vue-next'
import { usePeople } from '@/composables/usePeople'

type PersonRef = Task['assignees'][number]

// modelValue carries the full ref objects (not just ids) so the picker can
// render chips without an extra lookup; the emitted payload gives both the
// bare ids (for the PATCH body) and the resolved objects (for useUpdateTask's
// optimistic cache update).
const props = defineProps<{ modelValue: PersonRef[] }>()
const emit = defineEmits<{ 'update:modelValue': [{ ids: number[]; resolved: PersonRef[] }] }>()

const { t } = useI18n()
const open = ref(false)
const q = ref('')
// Debounced: usePeople keys its query on the search term, so passing the raw
// input ref fired one request per keystroke.
const debouncedQ = refDebounced(q, 250)
const { data: people } = usePeople(debouncedQ)

const selectedIds = computed(() => new Set(props.modelValue.map((p) => p.id)))

function isSelected(id: number) {
  return selectedIds.value.has(id)
}

function commit(next: PersonRef[]) {
  emit('update:modelValue', { ids: next.map((p) => p.id), resolved: next })
}

function toggle(person: PersonRef) {
  commit(isSelected(person.id) ? props.modelValue.filter((p) => p.id !== person.id) : [...props.modelValue, person])
}

function remove(id: number) {
  commit(props.modelValue.filter((p) => p.id !== id))
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap gap-1">
      <Badge v-for="p in modelValue" :key="p.id" variant="secondary" class="gap-1 pe-1">
        {{ p.name }}
        <button
          type="button"
          class="rounded-full hover:bg-muted-foreground/20"
          :aria-label="t('tasks.drawer.removeAssignee')"
          @click="remove(p.id)"
        >
          <X class="size-3" />
        </button>
      </Badge>
      <span v-if="modelValue.length === 0" class="text-sm text-muted-foreground">{{ t('tasks.drawer.unassigned') }}</span>
    </div>

    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button variant="outline" size="sm" type="button">{{ t('tasks.drawer.assignees') }}</Button>
      </PopoverTrigger>
      <PopoverContent class="w-64 p-0" align="start">
        <div class="border-b p-2">
          <Input v-model="q" :placeholder="t('app.search')" class="h-8" />
        </div>
        <Command>
          <CommandList>
            <CommandEmpty>{{ t('app.noResults') }}</CommandEmpty>
            <CommandGroup>
              <CommandItem v-for="p in people ?? []" :key="p.id" :value="String(p.id)" @select="toggle({ id: p.id, name: p.name })">
                <span class="flex-1">{{ p.name }}</span>
                <Check v-if="isSelected(p.id)" class="size-4" />
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  </div>
</template>
