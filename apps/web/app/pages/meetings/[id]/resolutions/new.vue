<script setup lang="ts">
import MeetingProjectFilter from '@/components/meetings/MeetingProjectFilter.vue'
import { useCreateResolution, useMeeting } from '@/composables/useMeetings'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const query = useMeeting(id)
const { mutateAsync, isPending, error } = useCreateResolution()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/meetings/${id.value}`, ['/meetings']))
const canCreate = computed(() => query.data.value?.can_edit === true && !['done', 'cancelled'].includes(query.data.value.state))
const knownPeople = computed(() => {
  const meeting = query.data.value
  if (!meeting) return []
  const people = [meeting.organizer, meeting.secretary, ...meeting.attendees]
  return [...new Map(
    people
      .filter((person): person is { id: number; name: string } => Boolean(person))
      .map(person => [person.id, person] as const),
  ).values()]
})
const name = ref('')
const responsibleId = ref<number | ''>('')
const deadline = ref('')
const executionPeriod = ref('')
const projectId = ref<number | undefined>(undefined)
const priority = ref<'0' | '1' | '2' | '3'>('0')
function snapshot() {
  return JSON.stringify([name.value, responsibleId.value, deadline.value, executionPeriod.value, projectId.value, priority.value])
}
const baseline = ref(snapshot())
const dirty = computed(() => snapshot() !== baseline.value)
const validationMessage = computed(() => {
  if (!name.value.trim()) return t('meetingsUx.validation.resolutionName')
  if (!responsibleId.value) return t('meetingsUx.validation.responsible')
  if (!deadline.value && !executionPeriod.value.trim()) return t('meetingMinutesForm.validation.deadlineOrPeriod')
  return ''
})

async function save() {
  if (!hydrated.value || !canCreate.value || !name.value.trim() || !responsibleId.value || (!deadline.value && !executionPeriod.value.trim())) return
  await mutateAsync({
    meetingId: id.value,
    body: {
      name: name.value.trim(),
      responsible_id: Number(responsibleId.value),
      deadline: deadline.value || undefined,
      execution_period: executionPeriod.value.trim() || undefined,
      project_id: projectId.value ?? null,
      priority: priority.value,
    },
  })
  baseline.value = snapshot()
  await nextTick()
  await navigateTo(returnTo.value)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUi.newResolution')" :back-to="returnTo" />
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && !query.data.value" @retry="query.refetch">
    <div v-if="query.data.value && !canCreate" class="nasq-panel nasq-panel-body text-sm text-muted-foreground">{{ t('meetingMinutesForm.readOnlyMeeting') }}</div>
    <form v-else-if="query.data.value" class="nasq-form nasq-panel nasq-panel-body grid gap-5" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <SharedFormSection :title="t('meetingsUi.resolutions')" class="grid gap-4">
        <div class="grid gap-2">
          <Label for="res-name">{{ t('meetingsUi.resolutionTitle') }}</Label>
          <Input id="res-name" v-model="name" :disabled="!hydrated || isPending" required />
        </div>
        <div class="grid gap-2">
          <Label for="res-user">{{ t('meetingsUi.responsible') }}</Label>
          <select id="res-user" v-model="responsibleId" class="border-input h-9 w-full min-w-0 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || isPending" required>
            <option value="">{{ t('meetingsUi.responsible') }}</option>
            <option v-for="person in knownPeople" :key="person.id" :value="person.id">{{ person.name }}</option>
          </select>
        </div>
        <div class="grid gap-2">
          <Label for="res-deadline">{{ t('meetingsUi.deadline') }}</Label>
          <Input id="res-deadline" v-model="deadline" type="date" :disabled="!hydrated || isPending" />
          <p class="text-xs text-muted-foreground">{{ t('meetingMinutesForm.deadlineOrPeriodHint') }}</p>
        </div>
        <div class="grid gap-2">
          <Label for="res-period">{{ t('meetingMinutesForm.executionPeriod') }}</Label>
          <Input id="res-period" v-model="executionPeriod" maxlength="500" :disabled="!hydrated || isPending" :placeholder="t('meetingMinutesForm.executionPeriodPlaceholder')" />
        </div>
        <div class="grid gap-2 sm:col-span-2">
          <Label for="res-project">{{ t('meetingMinutesForm.project') }}</Label>
          <MeetingProjectFilter id="res-project" hide-label :model-value="projectId" :disabled="!hydrated || isPending" @update:model-value="projectId = $event" />
        </div>
        <div class="grid gap-2">
          <Label for="res-priority">{{ t('meetingsUi.priority') }}</Label>
          <select id="res-priority" v-model="priority" class="border-input h-9 w-full min-w-0 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || isPending">
            <option v-for="code in ['0', '1', '2', '3']" :key="code" :value="code">{{ t(`meetingsUx.priorityLabel.${code}`) }}</option>
          </select>
        </div>
      </SharedFormSection>
      <p v-if="validationMessage" class="text-sm text-muted-foreground" aria-live="polite">{{ validationMessage }}</p>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error.message }}</p>
      <div class="nasq-form-footer justify-end">
        <NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
        <Button type="submit" :disabled="!hydrated || !canCreate || isPending || Boolean(validationMessage)">{{ t('app.create') }}</Button>
      </div>
    </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
