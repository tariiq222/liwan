<script setup lang="ts">
import { parsePositiveId } from '@/utils/routeParams'
import { cleanMeetingEditorQuery, meetingMinutesEditorTo, parseMeetingEditorContext } from '@/utils/meetingEditorContext'
import { recordParentTo } from '@/utils/recordListOrigin'
import { MEETING_LIST_PATHS } from '@/modules/meetings/navigation'
import MeetingProjectFilter from '@/components/meetings/MeetingProjectFilter.vue'
import { useCreateResolution, useMeeting } from '@/composables/useMeetings'
import { ApiError } from '@/composables/useApi'

const route = useRoute()
const router = useRouter()
const sourcePaths = useRecordListPaths(MEETING_LIST_PATHS)
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const query = useMeeting(id)
const { mutateAsync, isPending, error } = useCreateResolution()
// The server refuses an empty assignee on this field; show it where the person is picked, not as a generic alert.
const responsibleServerError = computed(() => error.value instanceof ApiError && error.value.status === 422 && error.value.field === 'responsible_id' ? t('meetingsUx.validation.responsible') : undefined)
// Child pages always return to their current record; only normalized list context follows.
const editorContext = computed(() => parseMeetingEditorContext(route.query))
const backTo = computed(() => editorContext.value ? meetingMinutesEditorTo(id.value, route.query, sourcePaths.value) : recordParentTo(`/meetings/${id.value}`, { ...cleanMeetingEditorQuery(route.query), tab: 'resolutions' }, sourcePaths.value, route.hash))
const createdResolutionId = ref<number | null>(null)
const receiptId = computed(() => {
  const candidate = parsePositiveId(route.query.created_resolution_id)
  return candidate && query.data.value?.resolutions.some(item => item.id === candidate) ? candidate : null
})
const hasReceipt = computed(() => Boolean(createdResolutionId.value || route.query.created_resolution_id))
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
const formErrors = computed(() => ({
  ...(!name.value.trim() ? { name: t('meetingsUx.validation.resolutionName') } : {}),
  ...(!responsibleId.value ? { responsible: t('meetingsUx.validation.responsible') } : {}),
  ...(!deadline.value && !executionPeriod.value.trim() ? { deadline: t('meetingMinutesForm.validation.deadlineOrPeriod') } : {}),
}))
const formElement = ref<HTMLFormElement | null>(null)
const { attemptedSubmit, visibleErrors, validate } = useMeetingFormFeedback(formErrors, formElement)

async function returnAfterCreate(createdId: number) {
  await navigateTo(editorContext.value ? meetingMinutesEditorTo(id.value, route.query, sourcePaths.value, createdId) : backTo.value, { replace: true })
}
async function save() {
  if (!hydrated.value || !canCreate.value || isPending.value) return
  const completed = createdResolutionId.value ?? receiptId.value
  if (completed) { await returnAfterCreate(completed); return }
  // A receipt must resolve to this readable meeting before any recovery action.
  if (hasReceipt.value || !validate()) return
  const created = await mutateAsync({
    meetingId: id.value,
    body: {
      name: name.value.trim(), responsible_id: Number(responsibleId.value),
      deadline: deadline.value || undefined, execution_period: executionPeriod.value.trim() || undefined,
      project_id: projectId.value ?? null, priority: priority.value,
    },
  })
  createdResolutionId.value = created.id
  baseline.value = snapshot()
  await nextTick()
  // Record success on the current route before attempting departure. Refresh of
  // an aborted departure resolves this ID from the meeting instead of posting again.
  await router.replace({ path: route.path, query: { ...route.query, created_resolution_id: String(created.id) } })
  await returnAfterCreate(created.id)
}

</script>

<template>
  <SharedCreatePanel :title="t('meetingsUi.newResolution')" :back-to="backTo">
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && !query.data.value" @retry="query.refetch">
    <UAlert v-if="query.data.value && !canCreate" color="neutral" variant="subtle" :title="t('meetingMinutesForm.readOnlyMeeting')" />
    <div v-else-if="hasReceipt" class="grid gap-(--webvue-gap-card)">
      <UAlert :color="createdResolutionId || receiptId ? 'success' : 'warning'" :title="t(createdResolutionId || receiptId ? 'meetingsUx.recommendationCreated' : 'meetingsUx.recommendationReturn.unavailable')" />
      <UButton v-if="createdResolutionId || receiptId" type="button" class="w-fit" :disabled="!hydrated" :label="t('meetingsUx.returnAfterRecommendation')" @click="save" />
      <UButton v-else color="neutral" :to="backTo" :label="t('app.back')" />
    </div>
    <form ref="formElement" novalidate v-else-if="query.data.value" class="grid gap-(--webvue-gap-card)" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <UAlert v-if="editorContext" color="neutral" variant="subtle" icon="i-lucide-info" :title="t('meetingsUx.recommendationEditorContext', { name: query.data.value.name })" />
      <SharedFormSection panel :title="t('meetingsUi.resolutions')">
        <div class="webvue-form-grid">
          <UFormField :label="t('meetingsUi.resolutionTitle')" name="name" required :error="visibleErrors.name">
            <UInput id="res-name" v-model="name" class="w-full" :aria-invalid="Boolean(visibleErrors.name)" :disabled="!hydrated || isPending" required />
          </UFormField>
          <UFormField :label="t('meetingsUi.responsible')" name="responsible" required :error="visibleErrors.responsible || responsibleServerError">
            <SharedPersonPicker
              id="res-user"
              :model-value="responsibleId || null"
              value-key="user_id"
              :options="knownPeople"
              :disabled="!hydrated || isPending"
              :placeholder="t('meetingsUi.responsible')"
              @update:model-value="responsibleId = typeof $event === 'number' ? $event : ''"
            />
          </UFormField>
          <UFormField :label="t('meetingsUi.deadline')" name="deadline" :error="visibleErrors.deadline" :help="t('meetingMinutesForm.deadlineOrPeriodHint')">
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
      <UAlert v-if="attemptedSubmit && Object.keys(formErrors).length > 1" color="error" variant="subtle" role="alert" :title="t('meetingsUx.validationSummary', { count: Object.keys(formErrors).length })" />
      <UAlert v-if="error && !responsibleServerError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error.message" />
<SharedFormActions>
        <p class="text-xs text-muted">{{ t('meetingsUx.requiredHint') }}</p>
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
          <UButton type="submit" :disabled="!hydrated || !canCreate || isPending" :loading="isPending" :label="t('meetingsUx.createRecommendation')" />
        </div>
      </SharedFormActions>
    </form>
    </SharedPageState>
  </SharedCreatePanel>
</template>
