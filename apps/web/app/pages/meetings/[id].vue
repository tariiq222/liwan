<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { MEETING_LIST_PATHS } from '@/modules/meetings/navigation'
import MeetingAttachmentsTab from '@/components/meetings/MeetingAttachmentsTab.vue'
import MeetingEventList from '@/components/meetings/MeetingEventList.vue'
import MeetingMinutesDocument from '@/components/meetings/MeetingMinutesDocument.vue'
import MeetingRecordTabs from '@/components/meetings/MeetingRecordTabs.vue'
import MeetingResolutionsTab from '@/components/meetings/MeetingResolutionsTab.vue'
import MeetingVersionList from '@/components/meetings/MeetingVersionList.vue'
import { formatMeetingDate, formatMeetingTime, plainTextFromHtml, type MeetingMinutesFormValue, type MeetingMinutesRecommendation } from '@/utils/meetingMinutesForm'
import { formatDate, formatDateTime } from '@webvue/ui/app/utils/formatDate'
import { ApiError } from '@/composables/useApi'
import { useMeeting } from '@/composables/useMeetings'
import { useMeetingEvents, useMeetingVersions } from '@/composables/useMeetingWorkspace'
import { useMeetingTransitions } from '@/composables/useMeetingTransitions'
import { meetingStateBadgeProps, resolutionStateBadgeProps } from '@/utils/meetingStatus'
import { richTextHasContent } from '@/utils/richText'
import { parsePositiveId } from '@/utils/routeParams'
import { meetingTabFromRoute, meetingTabQuery, meetingHistoryViewFromRoute, type MeetingTab } from '@/utils/meetingTabs'

const route = useRoute()
const router = useRouter()
const sourcePaths = useRecordListPaths(MEETING_LIST_PATHS)
const { t, locale } = useI18n()
const hydrated = useHydrated()
const id = computed(() => parsePositiveId(route.params.id))
const isCreateResolution = computed(() => route.path === `/meetings/${route.params.id}/resolutions/new`)
const isDetail = computed(() => route.path === `/meetings/${route.params.id}` || isCreateResolution.value)
const query = useMeeting(computed(() => isDetail.value ? id.value : null))
// An invalid id has no record to load and uses the same not-found state as an unknown positive id.
const pageError = computed(() => query.error.value ?? (id.value === null ? new ApiError(404, 'not_found', t('errors.generic')) : null))
const { actionError, pendingMeetingAction, meetingActionConfirm, requestMeetingAction, confirmMeetingAction, transitioning } = useMeetingTransitions({ meetingId: id, meeting: query.data, hydrated })
const completionGaps = computed(() => {
  const meeting = query.data.value
  if (!meeting) return []
  const gaps: Array<'schedule' | 'minutes'> = []
  if (!meeting.start_datetime || !meeting.end_datetime) gaps.push('schedule')
  const form = meeting.minutes_form
  if (!plainTextFromHtml(meeting.minutes) && !(form && (form.opening.trim() || form.closing.trim() || form.topics.length))) gaps.push('minutes')
  return gaps
})
function prepareComplete() {
  requestMeetingAction('complete')
}
const meetingEndLabel = computed(() => {
  const meeting = query.data.value
  if (!meeting?.end_datetime) return '—'
  return formatDate(meeting.start_datetime) === formatDate(meeting.end_datetime)
    ? formatMeetingTime(meeting.end_datetime, locale.value)
    : formatDateTime(meeting.end_datetime)
})
const attachmentCount = ref(0)
const resolutionsBusy = ref(false)
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
function childTo(path: string, query = route.query) {
  return recordChildTo(path, query, sourcePaths.value, route.hash)
}
const activeTab = computed<MeetingTab>(() => isCreateResolution.value ? 'resolutions' : meetingTabFromRoute(route.query.tab, hydrated.value ? route.hash : undefined))
const historyView = computed(() => meetingHistoryViewFromRoute(route.query.tab, hydrated.value ? route.hash : undefined, route.query.history_view))
// The open-recommendations tile links to the tab that lists them, keeping returnTo and the list filters.
const resolutionsTabLink = computed(() => router.resolve({ query: meetingTabQuery(route.query, 'resolutions'), hash: '' }).fullPath)
const historyLinks = computed(() => [
  { key: 'meeting-history-events', label: t('meetingsUx.activity'), to: { query: { ...route.query, tab: 'history', history_view: 'events' }, hash: '' }, active: historyView.value === 'events' },
  { key: 'meeting-history-versions', label: t('meetingMinutesForm.versions'), to: { query: { ...route.query, tab: 'history', history_view: 'versions' }, hash: '' }, active: historyView.value === 'versions' },
])
const meetingTabs = computed(() => [
  { label: t('meetingsUi.summary'), value: 'summary' },
  { label: t('meetingsUi.minutes'), value: 'minutes' },
  { label: `${t('meetingsUi.resolutions')} (${query.data.value?.resolutions.length ?? 0})`, value: 'resolutions' },
  { label: `${t('meetingsUi.attachmentsTitle')} (${attachmentCount.value})`, value: 'attachments' },
  { label: t('meetingMinutesForm.history'), value: 'history' },
] satisfies { label: string; value: MeetingTab }[])
// Tabs are links: they keep every other query key (returnTo), clear the legacy hash, and work before hydration.
const tabLinks = computed(() => meetingTabs.value.map(tab => ({
  key: `meeting-tab-${tab.value}`,
  label: tab.label,
  to: { query: meetingTabQuery(route.query, tab.value), hash: '' },
  active: activeTab.value === tab.value,
})))
// Index of the first log tab (history); the strip draws a divider before it.
const logTabStart = computed(() => meetingTabs.value.findIndex(tab => tab.value === 'history'))

const moreActions = computed(() => {
  const m = query.data.value
  const groups = [[{ label: t('meetingMinutesForm.printPreview'), icon: 'i-lucide-printer', to: childTo(`/meetings/${id.value}/print`) }]]
  if (m?.can_manage && m.state !== 'cancelled' && m.state !== 'done') {
    groups.push([{ label: t('meetingsUx.cancelMeetingAction'), icon: 'i-lucide-ban', color: 'error', disabled: transitioning.value, onSelect: () => requestMeetingAction('cancel') }] as never)
  }
  return groups
})
// The heading is the meeting's name; behind the create-recommendation panel it stays the application name, as before.
const recordTitle = computed(() => isCreateResolution.value
  ? t('nav.meetings')
  : query.data.value?.name ?? (pageError.value ? t('nav.meetings') : ''))
const historicalSnapshot = computed(() => query.data.value?.state === 'done' ? query.data.value?.minutes_snapshot ?? null : null)
const doneWithoutSnapshot = computed(() => query.data.value?.state === 'done' && !historicalSnapshot.value)
const eventPage = ref(1)
const versionPage = ref(1)
const selectedVersionId = ref<number | null>(null)
const workspacePageSize = 25
const eventQuery = useMeetingEvents(
  computed(() => activeTab.value === 'history' && historyView.value === 'events' && isDetail.value ? id.value : null),
  computed(() => ({ limit: workspacePageSize, offset: (eventPage.value - 1) * workspacePageSize })),
)
const versionQuery = useMeetingVersions(
  computed(() => activeTab.value === 'history' && historyView.value === 'versions' && isDetail.value ? id.value : null),
  computed(() => ({ limit: workspacePageSize, offset: (versionPage.value - 1) * workspacePageSize })),
)
type VersionSnapshot = {
  name?: string
  meeting_date?: string | null
  start_datetime?: string | null
  end_datetime?: string | null
  location?: string
  organizer?: { id: number; name: string } | null
  secretary?: { id: number; name: string } | null
  attendees?: Array<{ id: number; name: string }>
  agenda?: string
  minutes?: string
  minutes_form?: MeetingMinutesFormValue | null
  resolutions?: MeetingMinutesRecommendation[]
}
type VersionRow = { id: number; number: number; captured_at: string; actor: { id: number; name: string } | null; snapshot: VersionSnapshot | null }
const eventRows = computed(() => (eventQuery.data.value as unknown as { items: Array<{ id: number; meeting_id: number; meeting_name: string; occurred_at: string; actor: { id: number; name: string } | null; kind: string; summary: string }>; total: number } | undefined)?.items ?? [])
const eventTotal = computed(() => (eventQuery.data.value as unknown as { total?: number } | undefined)?.total ?? 0)
const versionRows = computed(() => (versionQuery.data.value as unknown as { items: VersionRow[]; total: number } | undefined)?.items ?? [])
const versionTotal = computed(() => (versionQuery.data.value as unknown as { total?: number } | undefined)?.total ?? 0)
const selectedVersion = computed(() => versionRows.value.find(version => version.id === selectedVersionId.value) ?? null)
const currentMinutesForm = computed(() => (query.data.value as typeof query.data.value & { minutes_form?: MeetingMinutesFormValue | null } | undefined)?.minutes_form ?? null)
const historicalMinutesForm = computed(() => (historicalSnapshot.value as typeof historicalSnapshot.value & { minutes_form?: MeetingMinutesFormValue | null } | null)?.minutes_form ?? null)
const historicalRecommendations = computed(() => (historicalSnapshot.value as typeof historicalSnapshot.value & { resolutions?: MeetingMinutesRecommendation[] } | null)?.resolutions ?? [])

watch(versionRows, rows => {
  const first = rows[0]
  if (first && !rows.some(row => row.id === selectedVersionId.value)) selectedVersionId.value = first.id
}, { immediate: true })

watch(() => [route.query.tab, route.hash, hydrated.value], async () => {
  if (!hydrated.value || (route.query.tab !== 'agenda' && route.hash !== '#meeting-agenda')) return
  await nextTick()
  if (typeof document !== 'undefined') document.getElementById('meeting-agenda')?.scrollIntoView({ block: 'start' })
}, { immediate: true, flush: 'post' })

function displayValue(value: string | null | undefined) {
  return value || '—'
}
</script>

<template>
  <SharedRecordPage :keep-content="!!query.data.value"
    v-if="isDetail"
    :title="recordTitle"
    :back-to="isCreateResolution ? undefined : backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch()"
  >
    <template #actions>
      <UButton v-if="activeTab === 'minutes' && query.data.value?.can_edit && !resolutionsBusy" :color="query.data.value.state === 'draft' ? 'neutral' : 'primary'" :variant="query.data.value.state === 'draft' ? 'outline' : 'solid'" :to="childTo(`/meetings/${id}/minutes`)" :label="t('meetingsUx.editMinutes')" />
      <UButton v-if="query.data.value?.can_edit && !resolutionsBusy" color="neutral" variant="outline" :to="childTo(`/meetings/${id}/edit`)" :label="t('app.edit')" />
      <UButton v-if="query.data.value?.can_edit && query.data.value.state === 'draft'" :disabled="!hydrated || transitioning" :label="t('meetingsUi.confirm')" @click="requestMeetingAction('confirm')" />
      <UButton v-if="query.data.value?.can_manage && query.data.value.state === 'confirmed'" :disabled="!hydrated || transitioning" :color="activeTab === 'summary' ? undefined : 'neutral'" :variant="activeTab === 'summary' ? 'solid' : 'outline'" :label="t('meetingsUi.complete')" @click="prepareComplete" />
      <UButton v-if="query.data.value?.can_manage && (query.data.value.state === 'done' || query.data.value.state === 'cancelled')" color="neutral" variant="outline" :disabled="!hydrated || transitioning" :label="t('meetingsUi.reopen')" @click="requestMeetingAction('reopen')" />
      <!-- Secondary and destructive actions live in one menu; cancelling still asks inline below the header. -->
      <UDropdownMenu :items="moreActions" :content="{ align: 'end' }">
        <UButton color="neutral" variant="outline" square icon="i-lucide-ellipsis" :aria-label="t('app.actions')" :disabled="!hydrated" data-testid="meeting-more-actions" />
      </UDropdownMenu>
    </template>
    <template #tabs>
      <MeetingRecordTabs :tabs="tabLinks" :log-tab-start="logTabStart" :label="t('meetingsUx.sections')" />
    </template>

    <div v-if="query.data.value" class="grid min-w-0 gap-(--webvue-gap-card)">
      <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="actionError" />
      <SharedRecordSection v-if="pendingMeetingAction?.action === 'complete' && completionGaps.length" variant="action" :title="t('meetingsUx.completionReview')">
        <div class="flex flex-wrap items-center gap-2">
          <UButton v-for="gap in completionGaps" :key="gap" color="neutral" variant="outline" :to="childTo(`/meetings/${id}/${gap === 'schedule' ? 'edit' : 'minutes'}`)" :label="t(`meetingsUx.completionGaps.${gap}`)" />
          <UButton color="neutral" variant="ghost" :label="t('app.cancel')" @click="pendingMeetingAction = null" />
        </div>
      </SharedRecordSection>
      <SharedInlineConfirm
        v-if="pendingMeetingAction && meetingActionConfirm && !(pendingMeetingAction.action === 'complete' && completionGaps.length)"
        :color="meetingActionConfirm.color"
        :title="meetingActionConfirm.title"
        :confirm-label="meetingActionConfirm.label"
        :pending="transitioning"
        @cancel="pendingMeetingAction = null"
        @confirm="confirmMeetingAction"
      >
        <USelect v-if="pendingMeetingAction.action === 'cancel' && query.data.value.series_id" v-model="pendingMeetingAction.scope" class="mt-2 w-full" :aria-label="t('meetingsUi.scope')" :disabled="!hydrated || transitioning" :items="[{ label: t('meetingsUi.scopeThis'), value: 'this' }, { label: t('meetingsUi.scopeFollowing'), value: 'this_and_following' }]" />
      </SharedInlineConfirm>

      <template v-if="activeTab === 'summary'">
        <SharedRecordSection id="meeting-summary" :title="t('meetingsUi.sectionPeople')" variant="panel">
          <div class="grid gap-4 sm:grid-cols-2">
            <div><p class="text-sm text-muted">{{ t('meetingsUi.secretary') }}</p><p class="text-highlighted">{{ displayValue(query.data.value.secretary?.name) }}</p></div>
            <div><p class="mb-2 text-sm text-muted">{{ t('meetingsUi.attendees') }}</p>
              <ul v-if="query.data.value.attendees.length" class="flex min-w-0 flex-wrap gap-2"><li v-for="person in query.data.value.attendees" :key="person.id"><UBadge color="neutral" variant="subtle" class="whitespace-normal text-start">{{ person.name }}</UBadge></li></ul>
              <p v-else class="text-sm text-muted">{{ t('meetingsUi.emptyAttendees') }}</p>
            </div>
          </div>
        </SharedRecordSection>
        <SharedRecordSection id="meeting-agenda" variant="panel" :title="t('meetingsUi.agenda')" :description="historicalSnapshot ? t('meetingsUx.historicalMinutesTitle') : undefined">
          <div class="grid min-w-0 gap-3">
            <UAlert v-if="doneWithoutSnapshot" color="neutral" variant="subtle" icon="i-lucide-info" :title="`${t('meetingsUx.historyUnavailable')} ${t('meetingsUx.currentContentAfterMissingHistory')}`" />
            <SharedRichText v-if="richTextHasContent(historicalSnapshot ? historicalSnapshot.agenda : query.data.value.agenda)" :html="historicalSnapshot ? historicalSnapshot.agenda : query.data.value.agenda" size="sm" />
            <SharedEmptyState v-else :title="t('meetingsUi.emptyAgenda')" />
          </div>
        </SharedRecordSection>
      </template>
      <template v-else-if="activeTab === 'minutes'">
                <MeetingMinutesDocument
          v-if="historicalSnapshot || currentMinutesForm"
          :meeting="query.data.value"
          :compact="!historicalSnapshot"
          :snapshot="historicalSnapshot"
          :form="historicalSnapshot ? historicalMinutesForm : currentMinutesForm"
          :recommendations="historicalSnapshot ? historicalRecommendations : query.data.value.resolutions"
          :legacy-agenda="historicalSnapshot ? historicalSnapshot.agenda : query.data.value.agenda"
          :legacy-minutes="historicalSnapshot ? historicalSnapshot.minutes : query.data.value.minutes"
          :legacy-recommendations="historicalSnapshot ? historicalRecommendations : query.data.value.resolutions"
          :title="t('meetingMinutesForm.documentTitle')"
        />
        <SharedRecordSection v-if="!historicalSnapshot && !currentMinutesForm" id="meeting-minutes" variant="panel" :title="t('meetingsUi.minutes')">
          <div class="grid min-w-0 gap-3">
            <UAlert v-if="doneWithoutSnapshot" color="neutral" variant="subtle" icon="i-lucide-info" :title="`${t('meetingsUx.historyUnavailable')} ${t('meetingsUx.currentContentAfterMissingHistory')}`" />
            <SharedRichText v-if="richTextHasContent(query.data.value.minutes)" :html="query.data.value.minutes" size="sm" />
            <SharedEmptyState v-else :title="t('meetingsUi.emptyMinutes')" />
          </div>
        </SharedRecordSection>
        <SharedRecordSection v-if="historicalSnapshot" id="meeting-snapshot" variant="list" :title="t('meetingsUx.historicalDecisionStates')" :description="t('meetingsUx.historicalMinutesTitle')">
          <div v-if="!historicalSnapshot.resolutions.length" class="p-(--webvue-card-pad)"><SharedEmptyState :title="t('meetingsUi.emptyResolutions')" /></div>
          <div v-for="item in historicalSnapshot.resolutions" :key="item.id" class="grid min-w-0 gap-1 px-(--webvue-card-pad) py-3 text-sm">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="font-semibold text-highlighted">{{ item.name }}</span>
              <SharedStatusBadge v-bind="resolutionStateBadgeProps(item.state, t)" />
              <span v-if="item.meeting_name" class="text-xs text-muted">{{ t('meetingsUx.snapshotOrigin', { name: item.meeting_name }) }}</span>
            </div>
            <SharedRichText v-if="richTextHasContent(item.result)" :html="item.result" size="sm" />
          </div>
        </SharedRecordSection>
      </template>
      <template v-else-if="activeTab === 'history'">
        <SharedRouteTabs variant="pill" :items="historyLinks" :ariaLabel="t('meetingMinutesForm.history')" />
        <MeetingEventList v-if="historyView === 'events'"
          :title="t('meetingsUx.activity')"
          :events="eventRows"
          :loading="eventQuery.isLoading.value"
          :error="eventQuery.error.value"
          :total="eventTotal"
          :page="eventPage"
          :page-size="workspacePageSize"
          @retry="eventQuery.refetch"
          @page="eventPage = $event"
        />
        <div v-if="historyView === 'versions'" class="grid min-w-0 gap-(--webvue-gap-card)">
        <MeetingVersionList
          :versions="versionRows"
          :loading="versionQuery.isLoading.value"
          :error="versionQuery.error.value"
          :total="versionTotal"
          :page="versionPage"
          :page-size="workspacePageSize"
          :selected-id="selectedVersionId"
          @retry="versionQuery.refetch"
          @page="versionPage = $event; selectedVersionId = null"
          @select="selectedVersionId = $event.id"
        />
        <div v-if="selectedVersion?.snapshot" class="flex justify-end">
          <UButton color="neutral" variant="outline" size="sm" :to="childTo(`/meetings/${id}/print`, { ...route.query, version_id: String(selectedVersion.id) })" :label="t('meetingMinutesForm.printPreview')" />
        </div>
        <MeetingMinutesDocument
          v-if="selectedVersion?.snapshot"
          :meeting="query.data.value"
          :snapshot="selectedVersion.snapshot"
          :form="selectedVersion.snapshot.minutes_form"
          :recommendations="selectedVersion.snapshot.resolutions || []"
          :legacy-agenda="selectedVersion.snapshot.agenda"
          :legacy-minutes="selectedVersion.snapshot.minutes"
          :legacy-recommendations="selectedVersion.snapshot.resolutions || []"
          :title="t('meetingMinutesForm.versionDocumentTitle', { number: selectedVersion.number })"
        />
        </div>
      </template>
      <!-- Stays mounted so its filters, pending confirmations and in-flight state survive tab switches. -->
      <div v-show="activeTab === 'resolutions'" class="grid min-w-0 gap-(--webvue-gap-card)">
        <MeetingResolutionsTab :meeting="query.data.value" :meeting-id="query.data.value.id" @update:busy="resolutionsBusy = $event" />
      </div>
      <!-- Stays mounted so the tab label always shows the attachment count. -->
      <MeetingAttachmentsTab v-show="activeTab === 'attachments'" :meeting-id="query.data.value.id" :can-edit="query.data.value.can_edit" @count="attachmentCount = $event" />
    </div>

    <template v-if="query.data.value" #summary>
      <div class="grid min-w-0 gap-(--webvue-gap-card) lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]" data-testid="meeting-hero">
        <SharedRecordSection variant="panel">
          <div class="grid min-w-0 gap-3">
            <p class="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xl font-semibold text-highlighted">
              <span>{{ formatMeetingDate(query.data.value.meeting_date, locale) }}</span>
              <span v-if="query.data.value.start_datetime" dir="ltr" class="whitespace-nowrap tabular-nums">{{ hydrated ? displayValue(formatMeetingTime(query.data.value.start_datetime, locale)) : '—' }}<span v-if="query.data.value.end_datetime"> – {{ hydrated ? displayValue(meetingEndLabel) : '—' }}</span></span>
            </p>
            <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
              <SharedStatusBadge v-bind="meetingStateBadgeProps(query.data.value.state, t)" data-testid="meeting-state-badge" />
              <span v-if="query.data.value.organizer" class="inline-flex min-w-0 items-center gap-2"><SharedPersonAvatar :people="[query.data.value.organizer]" /><span class="truncate">{{ t('meetingsUi.organizer') }}: {{ query.data.value.organizer.name }}</span></span>
              <span v-if="query.data.value.location" class="inline-flex items-center gap-1.5"><UIcon name="i-lucide-map-pin" class="size-4 shrink-0" aria-hidden="true" />{{ query.data.value.location }}</span>
              <UButton v-if="query.data.value.meeting_url" color="neutral" variant="outline" size="sm" icon="i-lucide-video" :to="query.data.value.meeting_url" external target="_blank" rel="noopener" :label="t('meetingsUi.url')" />
            </div>
          </div>
        </SharedRecordSection>
        <SharedMetricTile density="compact" icon="i-lucide-users" :label="t('meetingsUi.attendees')" :value="query.data.value.attendees.length" />
        <SharedMetricTile density="compact" icon="i-lucide-list-checks" :label="t('meetingsUi.resolutions')" :value="query.data.value.open_resolution_count" :hint="t('meetingsUx.openOnly')" :to="resolutionsTabLink" />
      </div>
    </template>
    <template v-if="query.data.value" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('app.recordNumber')"><SharedRecordNumber :value="query.data.value.reference" /></SharedPropertyRow>
        <SharedPropertyRow v-if="query.data.value.series" :label="t('meetingsUi.series')"><UButton color="primary" variant="link" class="p-0 whitespace-normal text-start" :to="`/meetings/series/${query.data.value.series.id}`">{{ query.data.value.series.name }}</UButton></SharedPropertyRow>
        <SharedPropertyRow v-if="query.data.value.project" :label="t('meetingsUi.project')" :value="query.data.value.project.name" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
  <NuxtPage />
</template>
