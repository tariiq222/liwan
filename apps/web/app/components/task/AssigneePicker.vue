<script setup lang="ts">
import type { Task } from '@nasq/contracts'
import type { PickedPerson } from '@/components/shared/PersonPicker.vue'

type PersonRef = Task['assignees'][number]

// modelValue carries the full ref objects (not just ids) so the picker can
// render chips without an extra lookup; the emitted payload gives both the
// bare ids (for the PATCH body) and the resolved objects (for useUpdateTask's
// optimistic cache update). Searching and selection belong to
// SharedPersonPicker; task assignees use the PersonRef `id` the task API takes
// as `user_ids`.
const props = defineProps<{ modelValue: PersonRef[]; labelledby?: string }>()
const emit = defineEmits<{ 'update:modelValue': [{ ids: number[]; resolved: PersonRef[] }] }>()

const { t } = useI18n()
const hydrated = useHydrated()

const selectedIds = computed(() => props.modelValue.map((p) => p.id))

function commit(next: PersonRef[]) {
  emit('update:modelValue', { ids: next.map((p) => p.id), resolved: next })
}

function remove(id: number) {
  commit(props.modelValue.filter((p) => p.id !== id))
}

// SharedPersonPicker resolves every selected id to `{ id, name }`, falling back
// to `known` (the current assignees) for ids outside the search results.
function onResolve(people: PickedPerson[]) {
  const byId = new Map<number, PersonRef>(props.modelValue.map((p) => [p.id, p]))
  commit(people.map((person) => byId.get(person.id) ?? { id: person.id, name: person.name }))
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
          icon="i-lucide-x"
          class="rounded-full"
          :aria-label="t('tasks.drawer.removeAssignee')"
          :disabled="!hydrated"
          @click="remove(p.id)"
        />
      </UBadge>
      <span v-if="modelValue.length === 0" class="text-sm text-muted">{{ t('tasks.drawer.unassigned') }}</span>
    </div>

    <SharedPersonPicker
      :model-value="selectedIds"
      multiple
      value-key="id"
      :known="modelValue"
      :placeholder="t('tasks.drawer.assignees')"
      :aria-labelledby="props.labelledby"
      @resolve="onResolve"
    />
  </div>
</template>
