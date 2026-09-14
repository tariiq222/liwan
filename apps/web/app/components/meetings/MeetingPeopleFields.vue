<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { usePeople } from '@/composables/usePeople'
import { mergeMeetingPeople, splitMeetingPeople, type MeetingPerson } from '@/utils/meetingPeople'

const attendeeIds = defineModel<number[]>('attendeeIds', { required: true })
const secretaryId = defineModel<number | null>('secretaryId')
const props = defineProps<{ known?: MeetingPerson[]; disabled?: boolean }>()

const { t } = useI18n()
const NO_SECRETARY = '__none__'
const attendeeQuery = ref('')
const secretaryQuery = ref('')
const attendeeSearch = refDebounced(attendeeQuery, 250)
const secretarySearch = refDebounced(secretaryQuery, 250)
const people = usePeople(attendeeSearch)
const secretaryPeople = usePeople(secretarySearch)
const remembered = ref<Record<number, string>>({})
const rememberedPeople = computed(() => Object.entries(remembered.value).map(([id, name]) => ({ id: Number(id), name })))
const knownPeople = computed(() => [...(props.known ?? []), ...rememberedPeople.value])
const selectedPeople = computed(() => splitMeetingPeople({ selectedIds: attendeeIds.value, secretaryId: secretaryId.value ?? null, known: knownPeople.value, results: [] }).selected)
const attendeeResults = computed(() => splitMeetingPeople({
  selectedIds: attendeeIds.value,
  secretaryId: secretaryId.value ?? null,
  known: knownPeople.value,
  results: (people.data.value ?? []).map(person => ({ id: person.user_id, name: person.name })),
  limit: 50,
}).results)
const secretaryOptions = computed(() => mergeMeetingPeople({
  selectedIds: attendeeIds.value,
  secretaryId: secretaryId.value ?? null,
  known: knownPeople.value,
  results: (secretaryPeople.data.value ?? []).map(person => ({ id: person.user_id, name: person.name })),
}))
const secretarySelect = computed({
  get: () => secretaryId.value ?? NO_SECRETARY,
  set: value => { secretaryId.value = value === NO_SECRETARY ? null : Number(value) },
})

watch([attendeeIds, secretaryId, () => props.known, () => people.data.value, () => secretaryPeople.data.value], () => {
  const next = { ...remembered.value }
  const available = [...(props.known ?? []), ...(people.data.value ?? []).map(person => ({ id: person.user_id, name: person.name })), ...(secretaryPeople.data.value ?? []).map(person => ({ id: person.user_id, name: person.name }))]
  for (const person of available) {
    if ([...attendeeIds.value, ...(secretaryId.value ? [secretaryId.value] : [])].includes(person.id)) next[person.id] = person.name
  }
  remembered.value = next
}, { deep: true, immediate: true })

function toggle(id: number, name: string) {
  if (attendeeIds.value.includes(id)) attendeeIds.value = attendeeIds.value.filter(item => item !== id)
  else {
    remembered.value = { ...remembered.value, [id]: name }
    attendeeIds.value = [...attendeeIds.value, id]
  }
}

function remove(id: number) {
  attendeeIds.value = attendeeIds.value.filter(item => item !== id)
}

</script>

<template>
  <fieldset class="grid gap-3">
    <legend class="text-sm font-medium">{{ t('meetingsUi.attendees') }}</legend>
    <div class="grid gap-2">
      <label for="meeting-attendee-search" class="text-sm font-medium text-highlighted">{{ t('meetingsUi.searchPeople') }}</label>
      <UInput id="meeting-attendee-search" v-model="attendeeQuery" class="w-full" :placeholder="t('meetingsUi.searchPeople')" :disabled="disabled" :aria-label="t('meetingsUi.searchPeople')" />
    </div>
    <div class="flex flex-wrap gap-1" aria-live="polite">
      <UBadge v-for="person in selectedPeople" :key="person.id" color="neutral" variant="subtle" class="gap-1 pe-1">
        <span>{{ person.name }}</span>
        <UButton type="button" color="error" variant="ghost" size="xs" class="rounded-full px-1" :aria-label="t('meetingsUx.removePerson', { name: person.name })" :disabled="disabled" label="×" @click="remove(person.id)" />
      </UBadge>
      <span v-if="!selectedPeople.length" class="text-sm text-muted-foreground">{{ t('meetingsUi.emptyAttendees') }}</span>
    </div>
    <div v-if="people.isLoading.value" class="text-sm text-muted-foreground" role="status">{{ t('meetingsUx.people.loading') }}</div>
    <div v-else-if="people.error.value" class="flex items-center gap-2 text-sm text-destructive" role="alert">
      <span>{{ t('meetingsUx.people.error') }}</span>
      <UButton type="button" color="primary" variant="outline" size="sm" :disabled="disabled" :label="t('meetingsUx.people.retry')" @click="people.refetch()" />
    </div>
    <div v-else-if="!attendeeResults.length" class="text-sm text-muted-foreground">{{ t('meetingsUx.people.empty') }}</div>
    <div v-else class="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-border p-2" tabindex="0">
      <label v-for="person in attendeeResults" :key="person.id" class="flex items-center gap-2 text-sm">
        <UCheckbox :model-value="attendeeIds.includes(person.id)" :disabled="disabled" :aria-label="person.name" @update:model-value="toggle(person.id, person.name)" />
        <span>{{ person.name }}</span>
      </label>
    </div>
    <div class="grid gap-2">
      <label for="meeting-secretary-search" class="text-sm font-medium text-highlighted">{{ t('meetingsUx.secretarySearch') }}</label>
      <UInput id="meeting-secretary-search" v-model="secretaryQuery" class="w-full" :placeholder="t('meetingsUx.secretarySearch')" :disabled="disabled" :aria-label="t('meetingsUx.secretarySearch')" />
      <div v-if="secretaryPeople.isLoading.value" class="text-sm text-muted-foreground" role="status">{{ t('meetingsUx.people.loading') }}</div>
      <div v-else-if="secretaryPeople.error.value" class="flex items-center gap-2 text-sm text-destructive" role="alert">
        <span>{{ t('meetingsUx.people.error') }}</span>
        <UButton type="button" color="primary" variant="outline" size="sm" :disabled="disabled" :label="t('meetingsUx.people.retry')" @click="secretaryPeople.refetch()" />
      </div>
      <USelect
        id="meeting-secretary"
        class="w-full"
        :aria-label="t('meetingsUi.secretary')"
        :disabled="disabled"
        v-model="secretarySelect"
        :items="[{ label: t('meetingsUx.noSecretary'), value: NO_SECRETARY }, ...secretaryOptions.map(person => ({ label: person.name, value: person.id }))]"
      />
    </div>
  </fieldset>
</template>
