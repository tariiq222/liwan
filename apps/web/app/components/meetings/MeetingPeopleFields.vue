<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { usePeople } from '@/composables/usePeople'
import { mergeMeetingPeople, splitMeetingPeople, type MeetingPerson } from '@/utils/meetingPeople'

const attendeeIds = defineModel<number[]>('attendeeIds', { required: true })
const secretaryId = defineModel<number | null>('secretaryId')
const props = defineProps<{ known?: MeetingPerson[]; disabled?: boolean }>()

const { t } = useI18n()
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

function chooseSecretary(event: Event) {
  secretaryId.value = Number((event.target as HTMLSelectElement).value) || null
}
</script>

<template>
  <fieldset class="grid gap-3">
    <legend class="text-sm font-medium">{{ t('meetingsUi.attendees') }}</legend>
    <div class="grid gap-2">
      <Label for="meeting-attendee-search">{{ t('meetingsUi.searchPeople') }}</Label>
      <Input id="meeting-attendee-search" v-model="attendeeQuery" :placeholder="t('meetingsUi.searchPeople')" :disabled="disabled" :aria-label="t('meetingsUi.searchPeople')" />
    </div>
    <div class="flex flex-wrap gap-1" aria-live="polite">
      <Badge v-for="person in selectedPeople" :key="person.id" variant="secondary" class="gap-1 pe-1">
        <span>{{ person.name }}</span>
        <button type="button" class="rounded-full px-1 hover:bg-muted-foreground/20" :aria-label="t('meetingsUx.removePerson', { name: person.name })" :disabled="disabled" @click="remove(person.id)">×</button>
      </Badge>
      <span v-if="!selectedPeople.length" class="text-sm text-muted-foreground">{{ t('meetingsUi.emptyAttendees') }}</span>
    </div>
    <div v-if="people.isLoading.value" class="text-sm text-muted-foreground" role="status">{{ t('meetingsUx.people.loading') }}</div>
    <div v-else-if="people.error.value" class="flex items-center gap-2 text-sm text-destructive" role="alert">
      <span>{{ t('meetingsUx.people.error') }}</span>
      <Button type="button" variant="outline" size="sm" :disabled="disabled" @click="people.refetch()">{{ t('meetingsUx.people.retry') }}</Button>
    </div>
    <div v-else-if="!attendeeResults.length" class="text-sm text-muted-foreground">{{ t('meetingsUx.people.empty') }}</div>
    <div v-else class="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-border p-2" tabindex="0">
      <label v-for="person in attendeeResults" :key="person.id" class="flex items-center gap-2 text-sm">
        <input type="checkbox" :checked="attendeeIds.includes(person.id)" :disabled="disabled" @change="toggle(person.id, person.name)">
        <span>{{ person.name }}</span>
      </label>
    </div>
    <div class="grid gap-2">
      <Label for="meeting-secretary-search">{{ t('meetingsUx.secretarySearch') }}</Label>
      <Input id="meeting-secretary-search" v-model="secretaryQuery" :placeholder="t('meetingsUx.secretarySearch')" :disabled="disabled" :aria-label="t('meetingsUx.secretarySearch')" />
      <div v-if="secretaryPeople.isLoading.value" class="text-sm text-muted-foreground" role="status">{{ t('meetingsUx.people.loading') }}</div>
      <div v-else-if="secretaryPeople.error.value" class="flex items-center gap-2 text-sm text-destructive" role="alert">
        <span>{{ t('meetingsUx.people.error') }}</span>
        <Button type="button" variant="outline" size="sm" :disabled="disabled" @click="secretaryPeople.refetch()">{{ t('meetingsUx.people.retry') }}</Button>
      </div>
      <select id="meeting-secretary" class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :aria-label="t('meetingsUi.secretary')" :disabled="disabled" :value="secretaryId ?? ''" @change="chooseSecretary">
        <option value="">{{ t('meetingsUx.noSecretary') }}</option>
        <option v-for="person in secretaryOptions" :key="person.id" :value="person.id">{{ person.name }}</option>
      </select>
    </div>
  </fieldset>
</template>
