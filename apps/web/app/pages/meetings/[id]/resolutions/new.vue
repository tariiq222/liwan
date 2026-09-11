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
const deadlineField = computed({ get: () => deadline.value || null, set: value => { deadline.value = value || '' } })
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
    <UAlert v-if="query.data.value && !canCreate" color="neutral" variant="subtle" :title="t('meetingMinutesForm.readOnlyMeeting')" />
    <form v-else-if="query.data.value" class="space-y-8" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <SharedFormSection :title="t('meetingsUi.resolutions')">
        <div class="nasq-form-grid">
          <UFormField :label="t('meetingsUi.resolutionTitle')" name="name" required>
            <UInput id="res-name" v-model="name" class="w-full" :disabled="!hydrated || isPending" required />
          </UFormField>
          <UFormField :label="t('meetingsUi.responsible')" name="responsible" required>
            <USelectMenu
              id="res-user"
              :model-value="responsibleId || undefined"
                @update:model-value="responsibleId = $event ?? ''"
              class="w-full"
              value-key="value"
              :disabled="!hydrated || isPending"
              :items="knownPeople.map(person => ({ label: person.name, value: person.id }))"
              :placeholder="t('meetingsUi.responsible')"
            />
          </UFormField>
          <UFormField :label="t('meetingsUi.deadline')" name="deadline" :help="t('meetingMinutesForm.deadlineOrPeriodHint')">
            <SharedDateField id="res-deadline" v-model="deadlineField" class="w-full" :disabled="!hydrated || isPending" />
          </UFormField>
          <UFormField :label="t('meetingMinutesForm.executionPeriod')" name="executionPeriod">
            <UInput id="res-period" v-model="executionPeriod" maxlength="500" class="w-full" :disabled="!hydrated || isPending" :placeholder="t('meetingMinutesForm.executionPeriodPlaceholder')" />
          </UFormField>
          <UFormField class="sm:col-span-2" :label="t('meetingMinutesForm.project')" name="project">
            <MeetingProjectFilter id="res-project" hide-label :model-value="projectId" :disabled="!hydrated || isPending" @update:model-value="projectId = $event" />
          </UFormField>
          <UFormField :label="t('meetingsUi.priority')" name="priority">
            <USelect
              id="res-priority"
              v-model="priority"
              class="w-full"
              :disabled="!hydrated || isPending"
              :items="['0', '1', '2', '3'].map(code => ({ label: t(`meetingsUx.priorityLabel.${code}`), value: code }))"
            />
          </UFormField>
        </div>
      </SharedFormSection>
      <p v-if="validationMessage" class="text-sm text-muted-foreground" aria-live="polite">{{ validationMessage }}</p>
      <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error.message" />
      <div class="nasq-form-footer justify-end">
        <UButton type="button" color="secondary" :to="returnTo" :label="t('app.cancel')" />
        <UButton type="submit" :disabled="!hydrated || !canCreate || isPending || Boolean(validationMessage)" :label="t('app.create')" />
      </div>
    </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
