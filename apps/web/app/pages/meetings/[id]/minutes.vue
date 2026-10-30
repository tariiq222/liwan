<script setup lang="ts">
import { owningListBack, recordParentTo, recordSiblingTo } from '@/utils/recordListOrigin'
import { MEETING_LIST_PATHS } from '@/modules/meetings/navigation'
import DescriptionEditor from '@/components/shared/form/DescriptionEditor.vue'
import MeetingMinutesDocument from '@/components/meetings/MeetingMinutesDocument.vue'
import MeetingMinutesForm from '@/components/meetings/MeetingMinutesForm.vue'
import { createMeetingMinutesForm, type MeetingMinutesFormValue, type MeetingMinutesSnapshotLike, validateMeetingMinutesForm } from '@/utils/meetingMinutesForm'
import { useMeeting, usePatchMeeting } from '@/composables/useMeetings'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'
import { parsePositiveId } from '@/utils/routeParams'
import { attachNewMeetingRecommendation, cleanMeetingEditorQuery, meetingRecommendationCreateTo, parseMeetingEditorContext } from '@/utils/meetingEditorContext'
import { ApiError } from '@/composables/useApi'

const route = useRoute()
const sourcePaths = useRecordListPaths(MEETING_LIST_PATHS)
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => parsePositiveId(route.params.id))
const query = useMeeting(id)
// An id that is not a canonical positive integer has no record to load and shows the same not-found state as an unknown id.
const pageError = computed(() => query.error.value ?? (id.value !== null ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const { mutateAsync, isPending, error, reset } = usePatchMeeting()
// Child pages always return to their current record; only normalized list context follows.
const backTo = computed(() => id.value === null ? owningListBack(route.query, sourcePaths.value, route.hash) : recordParentTo(`/meetings/${id.value}`, { ...cleanMeetingEditorQuery(route.query), tab: 'minutes' }, sourcePaths.value, route.hash))
const agenda = ref('')
const minutes = ref('')
const minutesForm = ref<MeetingMinutesFormValue>(createMeetingMinutesForm())
const hasStructuredForm = ref(false)
const loaded = ref(false)
const recommendationReturn = ref<'linked' | 'already_linked' | 'unassigned' | 'unavailable' | null>(null)
const attemptedSubmit = ref(false)
const baseline = ref('')
// The server revision the editor opened on; a background refetch must not replace it, or a concurrent save would go unnoticed.
const openedWriteDate = ref<string | null>(null)

function snapshot() {
  return JSON.stringify([minutes.value, minutesForm.value])
}

function seedMeeting(meeting: typeof query.data.value) {
  if (!meeting || loaded.value) return
  const current = meeting as typeof meeting & { minutes_form?: MeetingMinutesFormValue | null }
  const source = (meeting.state === 'done' ? (current as typeof current & { minutes_snapshot?: MeetingMinutesSnapshotLike | null }).minutes_snapshot : null) ?? current
  agenda.value = source.agenda ?? ''
  minutes.value = source.minutes ?? ''
  hasStructuredForm.value = Boolean(source.minutes_form)
  minutesForm.value = createMeetingMinutesForm(source.minutes_form)
  baseline.value = snapshot()
  openedWriteDate.value = meeting.write_date
  loaded.value = true
  const context = parseMeetingEditorContext(route.query)
  if (context?.newResolutionId && meeting.can_edit && !['done', 'cancelled'].includes(meeting.state)) {
    const result = attachNewMeetingRecommendation(minutesForm.value, context, meeting.resolutions ?? [])
    minutesForm.value = result.form
    recommendationReturn.value = result.status
    if (typeof document !== 'undefined' && result.status === 'linked' && context.topicKey) {
      void nextTick(() => document.getElementById(`meeting-minutes-topic-${context.topicKey}`)?.focus())
    }
  }
}
watch(query.data, seedMeeting, { immediate: true })
useSsrQuerySeed(query, seedMeeting)

const dirty = computed(() => loaded.value && snapshot() !== baseline.value)
const { fieldErrors: serverErrors, submitError } = useMeetingSubmitError({
  error,
  reset,
  edits: snapshot,
  fields: {
    minutes_form: 'minutesForm',
    minutes: 'minutes',
  },
})
const canEdit = computed(() => query.data.value?.can_edit === true)
const lifecycleLocked = computed(() => query.data.value?.state === 'done' || query.data.value?.state === 'cancelled')
const structuredValidationErrors = computed(() => validateMeetingMinutesForm(minutesForm.value, query.data.value?.resolutions ?? []))
const canPersist = computed(() => canEdit.value && !lifecycleLocked.value && !structuredValidationErrors.value.length)
const readonlySnapshot = computed(() => (query.data.value?.state === 'done' ? (query.data.value as typeof query.data.value & { minutes_snapshot?: MeetingMinutesSnapshotLike | null })?.minutes_snapshot ?? null : null))
const readonlyForm = computed(() => readonlySnapshot.value ? readonlySnapshot.value.minutes_form ?? null : hasStructuredForm.value ? minutesForm.value : null)
const readonlyRecommendations = computed(() => readonlySnapshot.value?.resolutions ?? query.data.value?.resolutions ?? [])

async function save(navigateToRecommendation = false, topicKey?: string) {
  attemptedSubmit.value = true
  if (id.value === null || !hydrated.value || isPending.value || !canPersist.value || (!navigateToRecommendation && !dirty.value)) return
  const body = {
    minutes: minutes.value,
    minutes_form: minutesForm.value,
    write_date: openedWriteDate.value ?? undefined,
    scope: 'this' as const,
  } as Parameters<typeof mutateAsync>[0]['body']
  try {
    const saved = await mutateAsync({ id: id.value, body })
    if (saved.write_date) openedWriteDate.value = saved.write_date
  } catch {
    // The mutation retains its error for the inline alert and the draft stays editable.
    return
  }
  baseline.value = snapshot()
  await nextTick()
  await navigateTo(navigateToRecommendation
    ? meetingRecommendationCreateTo(id.value, route.query, sourcePaths.value, topicKey)
    : backTo.value)
}

function createRecommendation(topicKey?: string) {
  void save(true, topicKey)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUx.minutesEditorTitle')" :back-to="backTo" />
    <SharedPageState :loading="query.isLoading.value" :error="pageError" :empty="!query.isLoading.value && !pageError && !query.data.value" @retry="query.refetch">
      <form novalidate v-if="query.data.value" class="grid gap-(--liwan-gap-card)" @submit.prevent="save(false)">
        <SharedUnsavedChanges :dirty="dirty" />
        <UAlert color="neutral" variant="subtle" icon="i-lucide-info" :title="t('meetingsUx.minutesEditorContext', { name: query.data.value.name })" />
        <UAlert v-if="recommendationReturn" :color="recommendationReturn === 'unavailable' ? 'warning' : 'info'" variant="subtle" :title="t(`meetingsUx.recommendationReturn.${recommendationReturn}`)" />
        <p v-if="lifecycleLocked && query.data.value.can_manage" role="alert" class="text-sm text-muted">{{ t('meetingsUx.minutesEditorReopen') }} <UButton color="primary" variant="link" class="p-0" :to="backTo" :label="t('meetingsUx.openMeetingForReopen')" /></p>
        <UAlert v-else-if="!canEdit" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingsUx.minutesEditorForbidden')" />
        <MeetingMinutesDocument
          v-if="(readonlySnapshot || hasStructuredForm) && (lifecycleLocked || !canEdit)"
          :meeting="query.data.value"
          :snapshot="readonlySnapshot"
          :form="readonlyForm"
          :recommendations="readonlyRecommendations"
          :legacy-agenda="readonlySnapshot?.agenda ?? agenda"
          :legacy-minutes="readonlySnapshot?.minutes ?? minutes"
          :legacy-recommendations="readonlyRecommendations"
          :title="t('meetingMinutesForm.documentTitle')"
        />
        <UFormField v-else-if="!lifecycleLocked && canEdit" name="minutesForm" :error="serverErrors.minutesForm">
          <MeetingMinutesForm
            v-model="minutesForm"
            :meeting="query.data.value"
            :recommendations="query.data.value.resolutions"
            :legacy-agenda="agenda"
            :readonly="lifecycleLocked || !canEdit"
            :pending="isPending"
            @save-and-create-resolution="createRecommendation"
          />
        </UFormField>
        <SharedRecordSection :title="t('meetingsUi.agenda')" variant="panel">
          <template v-if="canEdit && !lifecycleLocked" #actions><UButton color="neutral" variant="outline" size="sm" :to="recordSiblingTo(`/meetings/${id}/edit`, { ...cleanMeetingEditorQuery(route.query), tab: 'summary' }, sourcePaths)" :label="t('app.edit')" /></template>
          <SharedRichText v-if="agenda" :html="agenda" size="sm" />
          <p v-else class="text-sm text-muted">{{ t('meetingsUi.emptyAgenda') }}</p>
        </SharedRecordSection>
        <SharedSubCard as="details" :open="Boolean(minutes)">
          <summary class="cursor-pointer text-sm font-semibold text-highlighted">{{ t('meetingsUx.additionalNotes') }}</summary>
          <UFormField name="minutes" :error="serverErrors.minutes" class="pt-(--liwan-subcard-pad)">
            <ClientOnly><DescriptionEditor :model-value="minutes" :task-id="-query.data.value.id" :aria-label="t('meetingsUx.additionalNotes')" :readonly="!canEdit || lifecycleLocked || isPending" @draft="minutes = $event.html" /></ClientOnly>
          </UFormField>
        </SharedSubCard>
        <UAlert v-if="attemptedSubmit && structuredValidationErrors.length" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingMinutesForm.validation.invalid')" />
        <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="submitError" />
<SharedFormActions>
          <p v-if="loaded && !dirty" class="text-xs text-muted">{{ t('meetingsUx.unchangedDraft') }}</p>
          <div class="ms-auto flex flex-wrap items-center gap-2">
            <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
            <UButton type="submit" :disabled="!hydrated || isPending || !canEdit || lifecycleLocked || !dirty" :loading="isPending" :label="t('meetingsUx.saveChanges')" />
          </div>
        </SharedFormActions>
      </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
