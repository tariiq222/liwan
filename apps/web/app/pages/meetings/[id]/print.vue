<script setup lang="ts">
import { owningListBack, recordParentTo } from '@/utils/recordListOrigin'
import { MEETING_LIST_PATHS } from '@/modules/meetings/navigation'
import MeetingMinutesDocument from '@/components/meetings/MeetingMinutesDocument.vue'
import { formatMeetingDate, selectMeetingMinutesSource, type MeetingMinutesFormValue, type MeetingMinutesRecommendation, type MeetingMinutesSnapshotLike } from '@/utils/meetingMinutesForm'
import { useMeeting } from '@/composables/useMeetings'
import { useMeetingVersion } from '@/composables/useMeetingWorkspace'
import { ApiError } from '@/composables/useApi'
import { meetingMinutesPdfPath } from '@/utils/meetingRoutes'
import { parsePositiveId } from '@/utils/routeParams'

const route = useRoute()
const sourcePaths = useRecordListPaths(MEETING_LIST_PATHS)
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { branding } = useBranding()
const id = computed(() => parsePositiveId(route.params.id))
const versionId = computed(() => parsePositiveId(route.query.version_id))
const meetingQuery = useMeeting(id)
const versionQuery = useMeetingVersion(id, versionId)
// Child pages always return to their current record; only normalized list context follows.
const backTo = computed(() => id.value === null ? owningListBack(route.query, sourcePaths.value, route.hash) : recordParentTo(`/meetings/${id.value}`, route.query, sourcePaths.value, route.hash))
// The page header used to give the shell its title and Escape its target; this page has none.
usePageHeader(() => t('meetingMinutesForm.printTitle'))
useEscapeBack(() => backTo.value)

const versionSnapshot = computed(() => (versionQuery.data.value as unknown as { snapshot?: MeetingMinutesSnapshotLike } | undefined)?.snapshot ?? null)
const source = computed(() => {
  const meeting = meetingQuery.data.value as (typeof meetingQuery.data.value & { minutes_form?: MeetingMinutesFormValue | null; minutes_snapshot?: MeetingMinutesSnapshotLike | null }) | undefined
  if (versionId.value && !versionSnapshot.value) return null
  return meeting ? selectMeetingMinutesSource(meeting, versionSnapshot.value) : null
})
const snapshot = computed(() => source.value?.snapshot ?? null)
const form = computed(() => source.value?.form ?? null)
const recommendations = computed(() => source.value?.kind === 'current' ? (meetingQuery.data.value?.resolutions ?? []) : (source.value?.resolutions ?? []))
const legacyAgenda = computed(() => source.value?.kind === 'current' ? meetingQuery.data.value?.agenda ?? '' : source.value?.agenda ?? '')
const legacyMinutes = computed(() => source.value?.kind === 'current' ? meetingQuery.data.value?.minutes ?? '' : source.value?.minutes ?? '')
const versionNumber = computed(() => (versionQuery.data.value as unknown as { number?: number } | undefined)?.number ?? null)
const printableDate = computed(() => source.value?.kind === 'current' ? meetingQuery.data.value?.meeting_date ?? '' : source.value?.snapshot?.meeting_date ?? '')
// An id that is not a canonical positive integer has no record to load and shows the same not-found state as an unknown id.
const printError = computed(() => meetingQuery.error.value || versionQuery.error.value || (id.value !== null ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const printReady = computed(() => Boolean(meetingQuery.data.value && !printError.value && (form.value || legacyAgenda.value || legacyMinutes.value || recommendations.value.length)))
const dateLabels = computed(() => {
  if (!printableDate.value) return { weekday: '', hijri: '' }
  const value = new Date(`${printableDate.value}T00:00:00`)
  if (Number.isNaN(value.getTime())) return { weekday: '', hijri: '' }
  return {
    weekday: new Intl.DateTimeFormat(locale.value, { weekday: 'long', calendar: 'gregory' }).format(value),
    hijri: new Intl.DateTimeFormat(locale.value, { dateStyle: 'long', calendar: 'islamic-umalqura' }).format(value),
  }
})

function printPage() {
  if (!hydrated.value || !import.meta.client) return
  window.print()
}

const facts = computed(() => [
  { key: 'date', label: t('meetingMinutesForm.date'), value: formatMeetingDate(printableDate.value, locale.value), ltr: true },
  { key: 'weekday', label: t('meetingMinutesForm.weekday'), value: dateLabels.value.weekday || '—', ltr: false },
  { key: 'hijri', label: t('meetingMinutesForm.hijriDate'), value: dateLabels.value.hijri || '—', ltr: false },
  ...(versionId.value ? [{ key: 'version', label: t('meetingMinutesForm.version'), value: versionNumber.value ? t('meetingMinutesForm.versionNumber', { number: versionNumber.value }) : '—', ltr: false }] : []),
])
const signatures = computed(() => [t('meetingMinutesForm.chairperson'), t('meetingMinutesForm.approverName'), t('meetingMinutesForm.signature')])
</script>

<template>
  <SharedStandalonePage variant="print" class="liwan-print-landscape">
    <h1 class="sr-only">{{ t('meetingMinutesForm.printTitle') }}</h1>
    <SharedPageState :loading="meetingQuery.isLoading.value || versionQuery.isLoading.value" :error="printError" :empty-text="t('meetingMinutesForm.printEmpty')" :empty="!meetingQuery.isLoading.value && !versionQuery.isLoading.value && !printReady" @retry="() => { meetingQuery.refetch(); versionQuery.refetch() }">
      <div v-if="meetingQuery.data.value && printReady" class="grid min-w-0 gap-4.5 print:gap-[10mm]" data-testid="meeting-print-sheet">
        <header class="flex min-w-0 items-center gap-3 border-b-2 border-primary pb-3">
          <img v-if="branding?.logo_url" :src="branding.logo_url" :alt="branding.name" class="size-13 object-contain">
          <div>
            <p class="text-xl font-bold">{{ branding?.name || t('app.productName') }}</p>
            <p class="text-sm text-muted">{{ t('meetingMinutesForm.printKicker') }}</p>
          </div>
        </header>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
          <div v-for="fact in facts" :key="fact.key" class="grid gap-0.5 rounded-control border border-default px-2.5 py-2">
            <span class="text-xs text-muted">{{ fact.label }}</span>
            <strong :dir="fact.ltr ? 'ltr' : undefined">{{ fact.value }}</strong>
          </div>
        </div>
        <MeetingMinutesDocument :meeting="meetingQuery.data.value" :snapshot="snapshot" :form="form" :recommendations="recommendations" :legacy-agenda="legacyAgenda" :legacy-minutes="legacyMinutes" :legacy-recommendations="recommendations" :title="t('meetingMinutesForm.documentTitle')" />
        <footer class="grid grid-cols-3 gap-7 pt-5">
          <div v-for="label in signatures" :key="label" class="grid gap-4.5">
            <span>{{ label }}</span>
            <span class="block min-h-7 border-b border-default" />
          </div>
        </footer>
      </div>
    </SharedPageState>
    <template #footer>
      <UButton color="neutral" variant="outline" :to="backTo" :label="t('app.back')" data-testid="meeting-print-back" />
      <!-- The PDF always renders the current minutes, so it is offered only when no saved version is shown. -->
      <UButton v-if="id !== null && !versionId && printReady" color="neutral" variant="outline" icon="i-lucide-file-down" :to="meetingMinutesPdfPath(id)" external :label="t('meetingMinutesForm.downloadPdf')" data-testid="meeting-print-pdf" />
      <UButton type="button" :disabled="!hydrated || !printReady || meetingQuery.isLoading.value || versionQuery.isLoading.value" :label="t('meetingMinutesForm.print')" data-testid="meeting-print-action" @click="printPage" />
    </template>
  </SharedStandalonePage>
</template>
