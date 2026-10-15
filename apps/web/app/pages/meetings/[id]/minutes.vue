<script setup lang="ts">
import { owningListBack, recordParentTo, recordSiblingTo, MEETING_LIST_PATHS } from '@/utils/recordListOrigin'
import DescriptionEditor from '@/components/shared/form/DescriptionEditor.vue'
import MeetingMinutesDocument from '@/components/meetings/MeetingMinutesDocument.vue'
import MeetingMinutesForm from '@/components/meetings/MeetingMinutesForm.vue'
import { createMeetingMinutesForm, type MeetingMinutesFormValue, type MeetingMinutesSnapshotLike, validateMeetingMinutesForm } from '@/utils/meetingMinutesForm'
import { useMeeting, usePatchMeeting } from '@/composables/useMeetings'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'
import { parsePositiveId } from '@/utils/routeParams'
import { ApiError } from '@/composables/useApi'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => parsePositiveId(route.params.id))
const query = useMeeting(id)
// An id that is not a canonical positive integer has no record to load and shows the same not-found state as an unknown id.
const pageError = computed(() => query.error.value ?? (id.value !== null ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const { mutateAsync, isPending, error, reset } = usePatchMeeting()
// Child pages always return to their current record; only normalized list context follows.
const backTo = computed(() => id.value === null ? owningListBack(route.query, MEETING_LIST_PATHS, route.hash) : recordParentTo(`/meetings/${id.value}`, route.query, MEETING_LIST_PATHS, route.hash))
const agenda = ref('')
const minutes = ref('')
const minutesForm = ref<MeetingMinutesFormValue>(createMeetingMinutesForm())
const hasStructuredForm = ref(false)
const loaded = ref(false)
const baseline = ref('')
// The server revision the editor opened on; a background refetch must not replace it, or a concurrent save would go unnoticed.
const openedWriteDate = ref<string | null>(null)

function snapshot() {
  return JSON.stringify([agenda.value, minutes.value, minutesForm.value])
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
const canSave = computed(() => canPersist.value && dirty.value)
const readonlySnapshot = computed(() => (query.data.value?.state === 'done' ? (query.data.value as typeof query.data.value & { minutes_snapshot?: MeetingMinutesSnapshotLike | null })?.minutes_snapshot ?? null : null))
const readonlyForm = computed(() => readonlySnapshot.value ? readonlySnapshot.value.minutes_form ?? null : hasStructuredForm.value ? minutesForm.value : null)
const readonlyRecommendations = computed(() => readonlySnapshot.value?.resolutions ?? query.data.value?.resolutions ?? [])

async function save(navigateToRecommendation = false) {
  if (id.value === null || !hydrated.value || isPending.value || !canPersist.value || (!navigateToRecommendation && !dirty.value)) return
  const body = {
    agenda: agenda.value,
    minutes: minutes.value,
    minutes_form: minutesForm.value,
    write_date: openedWriteDate.value ?? undefined,
    scope: 'this' as const,
  } as Parameters<typeof mutateAsync>[0]['body']
  await mutateAsync({
    id: id.value,
    body,
  })
  baseline.value = snapshot()
  await nextTick()
  await navigateTo(navigateToRecommendation
    ? recordSiblingTo(`/meetings/${id.value}/resolutions/new`, route.query, MEETING_LIST_PATHS, route.hash)
    : backTo.value)
}

function createRecommendation() {
  void save(true)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUx.minutesEditorTitle')" :back-to="backTo" />
    <SharedPageState :loading="query.isLoading.value" :error="pageError" :empty="!query.isLoading.value && !pageError && !query.data.value" @retry="query.refetch">
      <form v-if="query.data.value" class="space-y-8" @submit.prevent="save(false)">
        <SharedUnsavedChanges :dirty="dirty" />
        <p class="rounded-lg bg-elevated/50 px-3 py-2 text-sm ring ring-default">
          {{ t('meetingsUx.minutesEditorContext', { name: query.data.value.name }) }}
        </p>
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
        <SharedFormSection :title="t('meetingsUi.agenda')">
          <ClientOnly>
            <DescriptionEditor :model-value="agenda" :task-id="query.data.value.id" :aria-label="t('meetingsUx.agendaLabel')" :readonly="!canEdit || lifecycleLocked || isPending" @draft="agenda = $event.html" />
          </ClientOnly>
        </SharedFormSection>
        <SharedFormSection :title="t('meetingsUi.minutes')">
          <UFormField name="minutes" :error="serverErrors.minutes">
            <ClientOnly>
              <DescriptionEditor :model-value="minutes" :task-id="-query.data.value.id" :aria-label="t('meetingsUx.minutesLabel')" :readonly="!canEdit || lifecycleLocked || isPending" @draft="minutes = $event.html" />
            </ClientOnly>
          </UFormField>
        </SharedFormSection>
        <UAlert v-if="structuredValidationErrors.length" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('meetingMinutesForm.validation.invalid')" />
        <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="submitError" />
        <div class="nasq-form-footer justify-end">
          <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
          <UButton type="submit" :disabled="!hydrated || isPending || !canSave" :label="t('app.save')" />
        </div>
      </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
