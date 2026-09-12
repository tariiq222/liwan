<script setup lang="ts">
import MeetingMinutesDocument from '@/components/meetings/MeetingMinutesDocument.vue'
import { formatMeetingDate, selectMeetingMinutesSource, type MeetingMinutesFormValue, type MeetingMinutesRecommendation, type MeetingMinutesSnapshotLike } from '@/utils/meetingMinutesForm'
import { useMeeting } from '@/composables/useMeetings'
import { useMeetingVersion } from '@/composables/useMeetingWorkspace'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { branding } = useBranding()
const id = computed(() => Number(route.params.id))
const versionId = computed(() => {
  const value = Number(route.query.version_id)
  return Number.isInteger(value) && value > 0 ? value : null
})
const meetingQuery = useMeeting(id)
const versionQuery = useMeetingVersion(id, versionId)
const backTo = computed(() => safeReturnTo(route.query.returnTo, `/meetings/${id.value}?tab=minutes`, ['/meetings']))

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
const printError = computed(() => meetingQuery.error.value || versionQuery.error.value)
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
</script>

<template>
  <SharedPageContainer width="detail">
    <div class="meeting-print-page">
      <div class="meeting-print-header">
        <SharedPageHeader :title="t('meetingMinutesForm.printTitle')" :back-to="backTo">
          <template #actions>
            <UButton type="button" :disabled="!hydrated || !printReady || meetingQuery.isLoading.value || versionQuery.isLoading.value" :label="t('meetingMinutesForm.print')" @click="printPage" />
          </template>
        </SharedPageHeader>
      </div>
      <SharedPageState :loading="meetingQuery.isLoading.value || versionQuery.isLoading.value" :error="printError" :empty="!meetingQuery.isLoading.value && !versionQuery.isLoading.value && !printReady" @retry="() => { meetingQuery.refetch(); versionQuery.refetch() }">
        <article v-if="meetingQuery.data.value && printReady" class="meeting-print-sheet">
        <header class="meeting-print-brand">
          <img v-if="branding?.logo_url" :src="branding.logo_url" :alt="branding.name" class="meeting-print-logo">
          <div><p class="meeting-print-company">{{ branding?.name || t('app.productName') }}</p><p class="meeting-print-kicker">{{ t('meetingMinutesForm.printKicker') }}</p></div>
        </header>
        <div class="meeting-print-meta">
        <div><span>{{ t('meetingMinutesForm.date') }}</span><strong dir="ltr">{{ formatMeetingDate(printableDate, locale) }}</strong></div>
          <div><span>{{ t('meetingMinutesForm.weekday') }}</span><strong>{{ dateLabels.weekday || '—' }}</strong></div>
          <div><span>{{ t('meetingMinutesForm.hijriDate') }}</span><strong>{{ dateLabels.hijri || '—' }}</strong></div>
          <div v-if="versionId"><span>{{ t('meetingMinutesForm.version') }}</span><strong>{{ versionNumber ? t('meetingMinutesForm.versionNumber', { number: versionNumber }) : '—' }}</strong></div>
        </div>
        <MeetingMinutesDocument :meeting="meetingQuery.data.value" :snapshot="snapshot" :form="form" :recommendations="recommendations" :legacy-agenda="legacyAgenda" :legacy-minutes="legacyMinutes" :legacy-recommendations="recommendations" :title="t('meetingMinutesForm.documentTitle')" />
        <footer class="meeting-print-signatures">
          <div><span>{{ t('meetingMinutesForm.chairperson') }}</span><span class="meeting-print-signature-line" /></div>
          <div><span>{{ t('meetingMinutesForm.approverName') }}</span><span class="meeting-print-signature-line" /></div>
          <div><span>{{ t('meetingMinutesForm.signature') }}</span><span class="meeting-print-signature-line" /></div>
        </footer>
        </article>
      </SharedPageState>
    </div>
  </SharedPageContainer>
</template>

<style>
.meeting-print-sheet { min-width: 0; display: grid; gap: 18px; }
.meeting-print-brand { display: flex; min-width: 0; align-items: center; gap: 12px; border-block-end: 2px solid var(--brand-border); padding-block-end: 12px; }
.meeting-print-logo { width: 52px; height: 52px; object-fit: contain; }
.meeting-print-company { font-size: 1.25rem; font-weight: 700; }
.meeting-print-kicker { color: var(--muted-foreground); font-size: .875rem; }
.meeting-print-meta { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.meeting-print-meta > div { display: grid; gap: 3px; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.meeting-print-meta span { color: var(--muted-foreground); font-size: .75rem; }
.meeting-print-signatures { display: grid; gap: 28px; grid-template-columns: repeat(3, minmax(0, 1fr)); padding-block-start: 20px; }
.meeting-print-signatures > div { display: grid; gap: 18px; }
.meeting-print-signature-line { display: block; min-height: 28px; border-block-end: 1px solid var(--border); }
@media print {
  @page { size: A4 landscape; margin: 12mm; }
  body { background: white !important; }
  body > * { visibility: hidden; }
  .meeting-print-page, .meeting-print-page * { visibility: visible; }
  .meeting-print-page { position: absolute; inset: 0; width: 100%; max-width: none; padding: 0; }
  .meeting-print-page .meeting-print-header { display: none !important; }
  .meeting-print-page [data-slot="page-header"] { display: none; }
  .meeting-print-page .meeting-print-sheet { gap: 10mm; }
  .meeting-print-page [data-testid="meeting-minutes-document"] { border: 0; box-shadow: none; }
  .meeting-print-page [data-testid="meeting-minutes-document"] [data-slot="header"] { padding-inline: 0; }
  .meeting-print-page [data-testid="meeting-minutes-document"] [data-slot="body"] { padding-inline: 0; }
  .meeting-print-page .overflow-x-auto { overflow: visible !important; }
  .meeting-print-page .meeting-minutes-topic-table { min-width: 0 !important; width: 100%; table-layout: fixed; }
  .meeting-print-page .meeting-minutes-topic-table th { white-space: normal; }
  .meeting-print-page table thead { display: table-header-group; }
  .meeting-print-page table tr { break-inside: avoid; page-break-inside: avoid; }
}
</style>
