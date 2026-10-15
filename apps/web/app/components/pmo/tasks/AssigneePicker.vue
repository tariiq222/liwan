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
const selectedIds = computed(() => props.modelValue.map((p) => p.id))

function commit(next: PersonRef[]) {
  emit('update:modelValue', { ids: next.map((p) => p.id), resolved: next })
}

// SharedPersonPicker resolves every selected id to `{ id, name }`, falling back
// to `known` (the current assignees) for ids outside the search results.
function onResolve(people: PickedPerson[]) {
  const byId = new Map<number, PersonRef>(props.modelValue.map((p) => [p.id, p]))
  commit(people.map((person) => byId.get(person.id) ?? { id: person.id, name: person.name }))
}
</script>

<template>
  <!-- The picker's own trigger lists the chosen people (and the placeholder when nobody is), so the
       assignees appear once; a person is removed by unchecking them in the list. -->
  <SharedPersonPicker
    :model-value="selectedIds"
    multiple
    value-key="id"
    :known="modelValue"
    :placeholder="t('tasks.drawer.unassigned')"
    :aria-labelledby="props.labelledby"
    @resolve="onResolve"
  />
</template>
