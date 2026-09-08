<script setup lang="ts">
import { usePeople } from '@/composables/usePeople'

const attendeeIds = defineModel<number[]>('attendeeIds', { required: true })
const secretaryId = defineModel<number | null>('secretaryId')
const props = defineProps<{
  known?: { id: number; name: string }[]
  disabled?: boolean
}>()

const { t } = useI18n()
const peopleQ = ref('')
const people = usePeople(peopleQ)
const known = computed(() => new Map((props.known ?? []).map(person => [person.id, person.name])))
const options = computed(() => {
  const rows = new Map(known.value)
  for (const person of people.data.value ?? []) rows.set(person.user_id, person.name)
  return [...rows.entries()].map(([id, name]) => ({ id, name }))
})

function toggle(id: number) {
  attendeeIds.value = attendeeIds.value.includes(id)
    ? attendeeIds.value.filter(item => item !== id)
    : [...attendeeIds.value, id]
}
</script>

<template>
  <fieldset class="grid gap-2">
    <legend class="text-sm font-medium">{{ t('meetingsUi.attendees') }}</legend>
    <Input v-model="peopleQ" :placeholder="t('meetingsUi.searchPeople')" :disabled="disabled" :aria-label="t('meetingsUi.searchPeople')" />
    <p v-if="attendeeIds.length" class="text-sm text-muted-foreground">
      {{ t('meetingsUi.selected') }}:
      {{ attendeeIds.map(id => known.get(id) || options.find(person => person.id === id)?.name || id).join('، ') }}
    </p>
    <label v-for="person in options" :key="person.id" class="flex items-center gap-2 text-sm">
      <input type="checkbox" :checked="attendeeIds.includes(person.id)" :disabled="disabled" @change="toggle(person.id)">
      {{ person.name }}
    </label>
    <Label for="meeting-secretary">{{ t('meetingsUi.secretary') }}</Label>
    <select id="meeting-secretary" class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :disabled="disabled" :value="secretaryId ?? ''" @change="secretaryId = Number(($event.target as HTMLSelectElement).value) || null">
      <option value="">{{ t('meetingsUi.secretary') }}</option>
      <option v-for="person in options" :key="person.id" :value="person.id">{{ person.name }}</option>
    </select>
  </fieldset>
</template>
