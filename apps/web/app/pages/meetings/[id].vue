<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { MEETING_LIST_PATHS } from '@/modules/meetings/navigation'
import MeetingAttachmentsTab from '@/components/meetings/MeetingAttachmentsTab.vue'
import MeetingEventList from '@/components/meetings/MeetingEventList.vue'
import MeetingMinutesDocument from '@/components/meetings/MeetingMinutesDocument.vue'
import MeetingRecordTabs from '@/components/meetings/MeetingRecordTabs.vue'
import MeetingResolutionsTab from '@/components/meetings/MeetingResolutionsTab.vue'
import MeetingVersionList from '@/components/meetings/MeetingVersionList.vue'
import { formatMeetingDate, type MeetingMinutesFormValue, type MeetingMinutesRecommendation } from '@/utils/meetingMinutesForm'
import { ApiError } from '@/composables/useApi'
import { useMeeting } from '@/composables/useMeetings'
import { useMeetingEvents, useMeetingVersions } from '@/composables/useMeetingWorkspace'
import { useMeetingTransitions } from '@/composables/useMeetingTransitions'
import { formatLocalDateTime } from '@/utils/meetingDateTime'
import { meetingStateBadgeProps, resolutionStateBadgeProps } from '@/utils/meetingStatus'
import { richTextHasContent } from '@/utils/richText'
import { parsePositiveId } from '@/utils/routeParams'
import { meetingTabFromRoute, meetingTabQuery, type MeetingTab } from '@/utils/meetingTabs'

const route = useRoute()
const sourcePaths = useRecordListPaths(MEETING_LIST_PATHS)
const { t, locale } = useI18n()
const hydrated = useHydrated()
const id = computed(() => parsePositiveId(route.params.id))
const isCreateResolution = computed(() => route.path === `/meetings/${route.params.id}/resolutions/new`)
const isDetail = computed(() => route.path === `/meetings/${route.params.id}` || isCreateResolution.value)
const query = useMeeting(computed(() => isDetail.value ? id.value : null))
// An invalid id has no record to load and uses the same not-found state as an unknown positive id.
const pageError = computed(() => query.error.value ?? (id.value === null ? new ApiError(404, 'not_found', t('errors.generic')) : null))
const { pendingMeetingAction, meetingActionConfirm, requestMeetingAction, confirmMeetingAction, transitioning } = useMeetingTransitions({ meetingId: id, meeting: query.data, hydrated })
const attachmentCount = ref(0)
const resolutionsBusy = ref(false)
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
function childTo(path: string, query = route.query) {
  return recordChildTo(path, query, sourcePaths.value, route.hash)
}
const activeTab = computed<MeetingTab>(() => isCreateResolution.value ? 'resolutions' : meetingTabFromRoute(route.query.tab, hydrated.value ? route.hash : undefined))
const meetingTabs = computed(() => [
  { label: t('meetingsUi.summary'), value: 'summary' },
  { label: t('meetingsUi.agenda'), value: 'agenda' },
  { label: t('meetingsUi.minutes'), value: 'minutes' },
  { label: `${t('meetingsUi.resolutions')} (${query.data.value?.resolutions.length ?? 0})`, value: 'resolutions' },
  { label: `${t('meetingsUi.attachmentsTitle')} (${attachmentCount.value})`, value: 'attachments' },
  { label: t('meetingMinutesForm.history'), value: 'history' },
  { label: t('meetingMinutesForm.versions'), value: 'versions' },
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
  computed(() => activeTab.value === 'history' && isDetail.value ? id.value : null),
  computed(() => ({ limit: workspacePageSize, offset: (eventPage.value - 1) * workspacePageSize })),
)
const versionQuery = useMeetingVersions(
  computed(() => activeTab.value === 'versions' && isDetail.value ? id.value : null),
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
      <UButton v-if="query.data.value?.can_edit && !resolutionsBusy" color="neutral" variant="outline" :to="childTo(`/meetings/${id}/edit`)" :label="t('app.edit')" />
      <UButton v-if="query.data.value?.can_edit && query.data.value.state === 'draft'" :disabled="!hydrated || transitioning" :label="t('meetingsUi.confirm')" @click="requestMeetingAction('confirm')" />
      <UButton v-if="query.data.value?.can_manage && query.data.value.state === 'confirmed'" :disabled="!hydrated || transitioning" :label="t('meetingsUi.complete')" @click="requestMeetingAction('complete')" />
      <UButton v-if="query.data.value?.can_manage && (query.data.value.state === 'done' || query.data.value.state === 'cancelled')" color="neutral" variant="outline" :disabled="!hydrated || transitioning" :label="t('meetingsUi.reopen')" @click="requestMeetingAction('reopen')" />
      <!-- Secondary and destructive actions live in one menu; cancelling still asks inline below the header. -->
      <UDropdownMenu :items="moreActions" :content="{ align: 'end' }">
        <UButton color="neutral" variant="outline" square icon="i-lucide-ellipsis" :aria-label="t('app.actions')" :disabled="!hydrated" data-testid="meeting-more-actions" />
      </UDropdownMenu>
    </template>
    <template #tabs>
      <MeetingRecordTabs :tabs="tabLinks" :log-tab-start="logTabStart" :label="t('meetingsUx.sections')" />
    </template>

    <div v-if="query.data.value" class="grid min-w-0 gap-4">
      <SharedInlineConfirm
        v-if="pendingMeetingAction && meetingActionConfirm"
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
        <section id="meeting-summary" aria-labelledby="meeting-summary-title">
          <h2 id="meeting-summary-title" class="sr-only">{{ t('meetingsUi.summary') }}</h2>
          <UCard class="min-w-0">
            <div class="grid min-w-0 gap-6 lg:grid-cols-2">
              <section class="grid min-w-0 content-start gap-3">
                <h3 class="font-semibold text-highlighted">{{ t('meetingsUi.sectionSchedule') }}</h3>
                <dl class="grid gap-4 sm:grid-cols-2">
                  <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.date') }}</dt><dd class="text-highlighted">{{ formatMeetingDate(query.data.value.meeting_date, locale) }}</dd></div>
                  <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.start') }}</dt><dd class="text-highlighted">{{ hydrated ? displayValue(formatLocalDateTime(query.data.value.start_datetime)) : '—' }}</dd></div>
                  <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.end') }}</dt><dd class="text-highlighted">{{ hydrated ? displayValue(formatLocalDateTime(query.data.value.end_datetime)) : '—' }}</dd></div>
                  <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.location') }}</dt><dd class="break-words text-highlighted">{{ displayValue(query.data.value.location) }}</dd></div>
                  <div v-if="query.data.value.meeting_url" class="min-w-0 sm:col-span-2"><dt class="text-sm text-muted">{{ t('meetingsUi.url') }}</dt><dd><UButton color="primary" variant="link" class="p-0 break-all whitespace-normal text-start" :to="query.data.value.meeting_url" external target="_blank" rel="noopener" dir="ltr">{{ query.data.value.meeting_url }}</UButton></dd></div>
                </dl>
              </section>
              <section class="grid min-w-0 content-start gap-3">
                <h3 class="font-semibold text-highlighted">{{ t('meetingsUi.sectionPeople') }}</h3>
                <dl class="grid gap-4 sm:grid-cols-2">
                  <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.organizer') }}</dt><dd class="break-words text-highlighted">{{ displayValue(query.data.value.organizer?.name) }}</dd></div>
                  <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.secretary') }}</dt><dd class="break-words text-highlighted">{{ displayValue(query.data.value.secretary?.name) }}</dd></div>
                </dl>
                <div class="grid gap-2 border-t border-default pt-4">
                  <h4 class="text-sm text-muted">{{ t('meetingsUi.attendees') }}</h4>
                  <ul v-if="query.data.value.attendees.length" class="flex min-w-0 flex-wrap gap-2">
                    <li v-for="person in query.data.value.attendees" :key="person.id" class="min-w-0 max-w-full"><UBadge color="neutral" variant="subtle" class="max-w-full whitespace-normal break-words text-start">{{ person.name }}</UBadge></li>
                  </ul>
                  <SharedEmptyState v-else :title="t('meetingsUi.emptyAttendees')" />
                </div>
              </section>
            </div>
          </UCard>
        </section>
      </template>
      <template v-else-if="activeTab === 'agenda'">
        <section id="meeting-agenda" aria-labelledby="meeting-agenda-title" class="space-y-3">
          <h2 id="meeting-agenda-title" class="sr-only">{{ t('meetingsUi.agenda') }}</h2>
          <p v-if="historicalSnapshot" class="text-sm text-muted">{{ t('meetingsUx.historicalMinutesTitle') }}</p>
          <UCard class="min-w-0">
            <p v-if="doneWithoutSnapshot" class="mb-3 text-xs text-muted">{{ t('meetingsUx.historyUnavailable') }} {{ t('meetingsUx.currentContentAfterMissingHistory') }}</p>
            <SharedRichText v-if="richTextHasContent(historicalSnapshot ? historicalSnapshot.agenda : query.data.value.agenda)" :html="historicalSnapshot ? historicalSnapshot.agenda : query.data.value.agenda" size="sm" />
            <SharedEmptyState v-else :title="t('meetingsUi.emptyAgenda')" />
          </UCard>
        </section>
      </template>
      <template v-else-if="activeTab === 'minutes'">
        <div v-if="!historicalSnapshot && query.data.value.can_edit && !resolutionsBusy" class="flex flex-wrap items-center justify-end gap-2"><UButton size="sm" :to="childTo(`/meetings/${id}/minutes`)" :label="t('meetingsUx.editMinutes')" /></div>
        <MeetingMinutesDocument
          v-if="historicalSnapshot || currentMinutesForm"
          :meeting="query.data.value"
          :snapshot="historicalSnapshot"
          :form="historicalSnapshot ? historicalMinutesForm : currentMinutesForm"
          :recommendations="historicalSnapshot ? historicalRecommendations : query.data.value.resolutions"
          :legacy-agenda="historicalSnapshot ? historicalSnapshot.agenda : query.data.value.agenda"
          :legacy-minutes="historicalSnapshot ? historicalSnapshot.minutes : query.data.value.minutes"
          :legacy-recommendations="historicalSnapshot ? historicalRecommendations : query.data.value.resolutions"
          :title="t('meetingMinutesForm.documentTitle')"
        />
        <section v-if="!historicalSnapshot && !currentMinutesForm" id="meeting-minutes" aria-labelledby="meeting-minutes-title">
          <h2 id="meeting-minutes-title" class="sr-only">{{ t('meetingsUi.minutes') }}</h2>
          <UCard class="min-w-0">
            <p v-if="doneWithoutSnapshot" class="mb-3 text-xs text-muted">{{ t('meetingsUx.historyUnavailable') }} {{ t('meetingsUx.currentContentAfterMissingHistory') }}</p>
            <SharedRichText v-if="richTextHasContent(query.data.value.minutes)" :html="query.data.value.minutes" size="sm" />
            <SharedEmptyState v-else :title="t('meetingsUi.emptyMinutes')" />
          </UCard>
        </section>
        <SharedRecordSection v-if="historicalSnapshot" id="meeting-snapshot" :title="t('meetingsUx.historicalDecisionStates')" :description="t('meetingsUx.historicalMinutesTitle')">
          <UCard class="min-w-0">
            <div v-if="historicalSnapshot.resolutions.length" class="grid gap-3">
              <div v-for="item in historicalSnapshot.resolutions" :key="item.id" class="grid min-w-0 gap-1 text-sm">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <span class="font-medium text-highlighted">{{ item.name }}</span>
                  <span v-if="item.meeting_name" class="text-xs text-muted">{{ t('meetingsUx.snapshotOrigin', { name: item.meeting_name }) }}</span>
                  <SharedStatusBadge v-bind="resolutionStateBadgeProps(item.state, t)" />
                </div>
                <SharedRichText v-if="richTextHasContent(item.result)" :html="item.result" size="sm" />
              </div>
            </div>
            <SharedEmptyState v-else :title="t('meetingsUi.emptyResolutions')" />
          </UCard>
        </SharedRecordSection>
      </template>
      <template v-else-if="activeTab === 'history'">
        <MeetingEventList
          :events="eventRows"
          :loading="eventQuery.isLoading.value"
          :error="eventQuery.error.value"
          :total="eventTotal"
          :page="eventPage"
          :page-size="workspacePageSize"
          @retry="eventQuery.refetch"
          @page="eventPage = $event"
        />
      </template>
      <template v-else-if="activeTab === 'versions'">
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
      </template>
      <!-- Stays mounted so its filters, pending confirmations and in-flight state survive tab switches. -->
      <MeetingResolutionsTab v-show="activeTab === 'resolutions'" :meeting="query.data.value" :meeting-id="query.data.value.id" @update:busy="resolutionsBusy = $event" />
      <!-- Stays mounted so the tab label always shows the attachment count. -->
      <MeetingAttachmentsTab v-show="activeTab === 'attachments'" :meeting-id="query.data.value.id" :can-edit="query.data.value.can_edit" @count="attachmentCount = $event" />
    </div>

    <template v-if="query.data.value" #summary>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('meetingsUi.stateLabel')">
          <SharedStatusBadge v-bind="meetingStateBadgeProps(query.data.value.state, t)" data-testid="meeting-state-badge" />
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('app.recordNumber')"><SharedRecordNumber :value="query.data.value.reference" /></SharedPropertyRow>
        <SharedPropertyRow v-if="query.data.value.series" :label="t('meetingsUi.series')">
          <UButton color="primary" variant="link" class="p-0 whitespace-normal text-start" :to="`/meetings/series/${query.data.value.series.id}`">{{ query.data.value.series.name }}</UButton>
        </SharedPropertyRow>
        <SharedPropertyRow v-else :label="t('meetingsUi.series')" />
        <SharedPropertyRow :label="t('meetingsUi.project')" :value="query.data.value.project?.name" />
        <SharedPropertyRow :label="t('meetingsUi.resolutions')" :value="t('meetingsUi.openCount', { count: query.data.value.open_resolution_count }, query.data.value.open_resolution_count)" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
  <NuxtPage />
</template>
