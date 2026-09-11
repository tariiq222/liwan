<script setup lang="ts">
import type { Task } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import { X } from '@lucide/vue'
import { usePeople } from '@/composables/usePeople'

type PersonRef = Task['assignees'][number]

// modelValue carries the full ref objects (not just ids) so the picker can
// render chips without an extra lookup; the emitted payload gives both the
// bare ids (for the PATCH body) and the resolved objects (for useUpdateTask's
// optimistic cache update).
const props = defineProps<{ modelValue: PersonRef[]; labelledby?: string }>()
const emit = defineEmits<{ 'update:modelValue': [{ ids: number[]; resolved: PersonRef[] }] }>()

const { t } = useI18n()
const q = ref('')
// Debounced: usePeople keys its query on the search term, so passing the raw
// input ref fired one request per keystroke.
const debouncedQ = refDebounced(q, 250)
const { data: people } = usePeople(debouncedQ)

const selectedIds = computed(() => new Set(props.modelValue.map((p) => p.id)))

const peopleItems = computed(() => (people.value ?? []).map((p) => ({ label: p.name, value: p.id })))

function commit(next: PersonRef[]) {
  emit('update:modelValue', { ids: next.map((p) => p.id), resolved: next })
}

function remove(id: number) {
  commit(props.modelValue.filter((p) => p.id !== id))
}

// USelectMenu emits the full list of selected values on every change; this
// picker's contract needs the resolved PersonRef objects, not just ids, so
// unmatched ids fall back to the already-selected ref (still in modelValue)
// or the currently loaded search results (freshly picked).
function onSelectMenuChange(ids: number[]) {
  const byId = new Map<number, PersonRef>()
  for (const p of props.modelValue) byId.set(p.id, p)
  for (const p of people.value ?? []) byId.set(p.id, p)
  commit(ids.map((id) => byId.get(id)).filter((p): p is PersonRef => !!p))
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap gap-1">
      <UBadge v-for="p in modelValue" :key="p.id" variant="subtle" class="min-w-0 max-w-full gap-1 pe-1">
        <span class="min-w-0 max-w-full truncate" :title="p.name">{{ p.name }}</span>
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          square
          size="xs"
          class="rounded-full hover:bg-elevated/50"
          :aria-label="t('tasks.drawer.removeAssignee')"
          @click="remove(p.id)"
        >
          <X class="size-3" />
        </UButton>
      </UBadge>
      <span v-if="modelValue.length === 0" class="text-sm text-muted">{{ t('tasks.drawer.unassigned') }}</span>
    </div>

    <USelectMenu
      v-model:search-term="q"
      :model-value="[...selectedIds]"
      :items="peopleItems"
      :ignore-filter="true"
      multiple
      value-key="value"
      variant="outline"
      size="sm"
      :placeholder="t('tasks.drawer.assignees')"
      :search-input="{ placeholder: t('app.search') }"
      :aria-labelledby="props.labelledby"
      @update:model-value="onSelectMenuChange"
    >
        <template #default><span class="truncate">{{ modelValue.length ? modelValue.map(person => person.name).join('، ') : t('tasks.drawer.assignees') }}</span></template>
    </USelectMenu>
  </div>
</template>
