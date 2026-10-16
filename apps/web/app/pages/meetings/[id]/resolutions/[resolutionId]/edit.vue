<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import { MEETING_LIST_PATHS } from '@/modules/meetings/navigation'
import DescriptionEditor from '@/components/shared/form/DescriptionEditor.vue'
import MeetingProjectFilter from '@/components/meetings/MeetingProjectFilter.vue'
import { useMeeting, usePatchResolution } from '@/composables/useMeetings'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'

const route = useRoute()
const sourcePaths = useRecordListPaths(MEETING_LIST_PATHS)
const { t } = useI18n()
const hydrated = useHydrated()
const meetingId = computed(() => Number(route.params.id))
const resolutionId = computed(() => Number(route.params.resolutionId))
const query = useMeeting(meetingId)
const { mutateAsync, isPending, error } = usePatchResolution()
// Child pages always return to their current record; only normalized list context follows.
const backTo = computed(() => recordParentTo(`/meetings/${meetingId.value}`, route.query, sourcePaths.value, route.hash))
const resolution = computed(() => query.data.value?.resolutions.find(item => item.id === resolutionId.value) ?? null)
const knownPeople = computed(() => {
  const meeting = query.data.value
  if (!meeting) return []
  const people = [meeting.organizer, meeting.secretary, ...meeting.attendees, resolution.value?.responsible]
  return [...new Map(
    people
      .filter((person): person is { id: number; name: string } => Boolean(person))
      .map(person => [person.id, person] as const),
  ).values()]
})
const canEditDecision = computed(() => !!resolution.value?.can_edit_decision)
const canEditResult = computed(() => {
  const item = resolution.value
  if (!item) return false
  if (Array.isArray(item.allowed_actions)) return item.allowed_actions.includes('edit_result')
  return Boolean(item.can_update_execution) && !item.task_linked && !['done', 'cancelled'].includes(String(item.execution_state ?? item.state))
})
const canSave = computed(() => hydrated.value && (canEditDecision.value || canEditResult.value))
const name = ref('')
const responsibleId = ref<number | ''>('')
const deadline = ref('')
const deadlineField = computed({ get: () => deadline.value || null, set: value => { deadline.value = value || '' } })
const executionPeriod = ref('')
const projectId = ref<number | undefined>(undefined)
const priority = ref<'0' | '1' | '2' | '3'>('0')
const result = ref('')
const loaded = ref(false)
const baseline = ref('')

function snapshot() {
  return JSON.stringify([name.value, responsibleId.value, deadline.value, executionPeriod.value, projectId.value, priority.value, result.value])
}

function seedResolution(item: typeof resolution.value) {
  if (!item || loaded.value) return
  name.value = item.name
  responsibleId.value = item.responsible?.id ?? ''
  deadline.value = item.deadline ?? ''
  executionPeriod.value = item.execution_period ?? ''
  projectId.value = item.project?.id
  priority.value = item.priority
  result.value = item.result
  baseline.value = snapshot()
  loaded.value = true
}
watch(resolution, seedResolution, { immediate: true })
useSsrQuerySeed({ data: resolution }, seedResolution)

const dirty = computed(() => loaded.value && snapshot() !== baseline.value)
const formErrors = computed(() => ({
  ...(!name.value.trim() ? { name: t('meetingsUx.validation.resolutionName') } : {}),
  ...(!responsibleId.value ? { responsible: t('meetingsUx.validation.responsible') } : {}),
  ...(!deadline.value && !executionPeriod.value.trim() ? { deadline: t('meetingMinutesForm.validation.deadlineOrPeriod') } : {}),
}))
const formElement = ref<HTMLFormElement | null>(null)
const { attemptedSubmit, visibleErrors, validate } = useMeetingFormFeedback(formErrors, formElement)

async function save() {
  if (!canSave.value || isPending.value || !dirty.value || (canEditDecision.value && !validate())) return
  const body: Record<string, unknown> = {}
  if (canEditDecision.value) {
    body.name = name.value.trim()
    if (responsibleId.value) body.responsible_id = Number(responsibleId.value)
    body.deadline = deadline.value || null
    body.execution_period = executionPeriod.value.trim()
    body.project_id = projectId.value ?? null
    body.priority = priority.value
  }
  if (canEditResult.value) body.result = result.value
  if (!Object.keys(body).length) return
  await mutateAsync({ meetingId: meetingId.value, resolutionId: resolutionId.value, body })
  baseline.value = snapshot()
  await nextTick()
  const target = backTo.value
  await navigateTo(typeof target !== 'string' && !target.hash && !Object.keys(target.query ?? {}).length
    ? `/meetings/${meetingId.value}`
    : target)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUi.editResolution')" :back-to="backTo" />
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && !resolution" @retry="query.refetch">
      <UAlert v-if="resolution && !canEditDecision && !canEditResult" color="neutral" variant="subtle" :title="t('meetingsUi.resolutionReadOnly')" />
      <form ref="formElement" novalidate v-else-if="resolution" class="space-y-8" @submit.prevent="save">
        <SharedUnsavedChanges :dirty="dirty" />
        <SharedFormSection v-if="canEditDecision" :title="t('meetingsUi.resolutions')">
          <div class="webvue-form-grid">
            <UFormField :label="t('meetingsUi.resolutionTitle')" name="name" required :error="visibleErrors.name">
              <UInput id="resolution-name" v-model="name" class="w-full" :aria-invalid="Boolean(visibleErrors.name)" :disabled="!hydrated || isPending" required />
            </UFormField>
            <UFormField :label="t('meetingsUi.responsible')" name="responsible" required :error="visibleErrors.responsible">
              <SharedPersonPicker
                id="resolution-user"
                :model-value="responsibleId || null"
                value-key="user_id"
                :options="knownPeople"
                :disabled="!hydrated || isPending"
                :placeholder="t('meetingsUi.responsible')"
                @update:model-value="responsibleId = typeof $event === 'number' ? $event : ''"
              />
            </UFormField>
            <UFormField :label="t('meetingsUi.deadline')" name="deadline" :error="visibleErrors.deadline" :help="t('meetingMinutesForm.deadlineOrPeriodHint')">
              <SharedDateField id="resolution-deadline" v-model="deadlineField" class="w-full" :disabled="!hydrated || isPending" />
            </UFormField>
            <UFormField :label="t('meetingMinutesForm.executionPeriod')" name="executionPeriod">
              <UInput id="resolution-period" v-model="executionPeriod" maxlength="500" class="w-full" :disabled="!hydrated || isPending" :placeholder="t('meetingMinutesForm.executionPeriodPlaceholder')" />
            </UFormField>
            <UFormField class="sm:col-span-2" :label="t('meetingMinutesForm.project')" name="project">
              <MeetingProjectFilter id="resolution-project" hide-label :model-value="projectId" :disabled="!hydrated || isPending" @update:model-value="projectId = $event" />
            </UFormField>
            <UFormField :label="t('meetingsUi.priority')" name="priority">
              <USelect
                id="resolution-priority"
                v-model="priority"
                class="w-full"
                :disabled="!hydrated || isPending"
                :items="['0', '1', '2', '3'].map(code => ({ label: t(`meetingsUx.priorityLabel.${code}`), value: code }))"
              />
            </UFormField>
          </div>
        </SharedFormSection>
        <SharedFormSection v-if="canEditResult" :title="t('meetingsUi.result')">
          <ClientOnly>
            <DescriptionEditor :model-value="result" :task-id="0" :readonly="isPending" :aria-label="t('meetingsUx.completionNotes')" @draft="result = $event.html" />
          </ClientOnly>
        </SharedFormSection>
        <UAlert v-if="attemptedSubmit && Object.keys(formErrors).length > 1" color="error" variant="subtle" role="alert" :title="t('meetingsUx.validationSummary', { count: Object.keys(formErrors).length })" />
        <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error.message" />
        <p v-if="loaded && !dirty" class="text-xs text-muted">{{ t('meetingsUx.unchangedDraft') }}</p>
        <SharedFormActions class="justify-end">
          <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
          <UButton type="submit" :disabled="!canSave || isPending || !dirty" :loading="isPending" :label="t('meetingsUx.saveChanges')" />
        </SharedFormActions>
      </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
