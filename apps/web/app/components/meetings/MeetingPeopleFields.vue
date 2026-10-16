<script setup lang="ts">
import type { PickedPerson } from '@/components/shared/form/PersonPicker.vue'
import { mergeMeetingPeople, type MeetingPerson } from '@/utils/meetingPeople'

// Meeting attendees and secretary are res.users ids, so both pickers carry
// `user_id`. The secretary picker knows every attendee's name, and selected
// people keep their labels after a new search replaces the results.
const attendeeIds = defineModel<number[]>('attendeeIds', { required: true })
const secretaryId = defineModel<number | null>('secretaryId')
const props = defineProps<{ known?: MeetingPerson[]; disabled?: boolean; attendeesError?: string; secretaryError?: string }>()

const { t } = useI18n()
const hydrated = useHydrated()
const remembered = ref<Record<number, string>>({})
const knownPeople = computed(() => mergeMeetingPeople({
  selectedIds: [],
  secretaryId: null,
  known: [...(props.known ?? []), ...Object.entries(remembered.value).map(([id, name]) => ({ id: Number(id), name }))],
  results: [],
}))
const selectedPeople = computed(() => attendeeIds.value.map(id => knownPeople.value.find(person => person.id === id) ?? { id, name: `#${id}` }))

function remember(people: PickedPerson[]) {
  const next = { ...remembered.value }
  for (const person of people) if (person.name !== `#${person.id}`) next[person.id] = person.name
  remembered.value = next
}

function setAttendees(value: number | number[] | null) {
  attendeeIds.value = Array.isArray(value) ? value : []
}

function setSecretary(value: number | number[] | null) {
  secretaryId.value = typeof value === 'number' ? value : null
}

function remove(id: number) {
  attendeeIds.value = attendeeIds.value.filter(item => item !== id)
}
</script>

<template>
  <fieldset class="grid gap-4">
    <legend class="sr-only">{{ t('meetingsUi.attendees') }}</legend>
    <UFormField :label="t('meetingsUi.attendees')" name="attendees" :error="attendeesError">
      <SharedPersonPicker
        :model-value="attendeeIds"
        multiple
        value-key="user_id"
        :known="knownPeople"
        :placeholder="t('meetingsUi.searchPeople')"
        :disabled="disabled"
        @update:model-value="setAttendees"
        @resolve="remember"
      />
    </UFormField>
    <ul v-if="selectedPeople.length" class="flex flex-wrap gap-1.5" aria-live="polite" :aria-label="t('meetingsUi.selected')">
      <li v-for="person in selectedPeople" :key="person.id">
        <UBadge color="neutral" variant="subtle" class="gap-1 pe-0.5">
          <span>{{ person.name }}</span>
          <UButton type="button" color="error" variant="ghost" size="sm" square icon="i-lucide-x" :aria-label="t('meetingsUx.removePerson', { name: person.name })" :disabled="disabled || !hydrated" @click="remove(person.id)" />
        </UBadge>
      </li>
    </ul>
    <p v-else class="text-sm text-muted" aria-live="polite">{{ t('meetingsUi.emptyAttendees') }}</p>
    <UFormField :label="t('meetingsUi.secretary')" name="secretary" :error="secretaryError">
      <SharedPersonPicker
        :model-value="secretaryId ?? null"
        value-key="user_id"
        :known="knownPeople"
        :placeholder="t('meetingsUx.noSecretary')"
        :disabled="disabled"
        clear
        @update:model-value="setSecretary"
        @resolve="remember"
      />
    </UFormField>
  </fieldset>
</template>
