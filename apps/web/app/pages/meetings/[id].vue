<script setup lang="ts">
import { owningListBack, recordChildTo, MEETING_LIST_PATHS } from '@/utils/recordListOrigin'
import FilterBar from '@/components/shared/FilterBar.vue'
import MeetingEventList from '@/components/meetings/MeetingEventList.vue'
import MeetingMinutesDocument from '@/components/meetings/MeetingMinutesDocument.vue'
import MeetingVersionList from '@/components/meetings/MeetingVersionList.vue'
import { formatMeetingDate, type MeetingMinutesFormValue, type MeetingMinutesRecommendation } from '@/utils/meetingMinutesForm'
import { ApiError } from '@/composables/useApi'
import {
  useConvertResolution,
  useDeleteMeetingAttachment,
  useMeeting,
  useMeetingAction,
  useMeetingAttachments,
  useResolutionAction,
  useUploadMeetingAttachment,
} from '@/composables/useMeetings'
import { useMeetingEvents, useMeetingVersions } from '@/composables/useMeetingWorkspace'
import { useProjects } from '@/composables/useProjects'
import { formatLocalDateTime } from '@/utils/meetingDateTime'
import { meetingStateBadgeProps, resolutionStateBadgeProps } from '@/utils/meetingStatus'
import { richTextHasContent } from '@/utils/richText'
import { filterMeetingResolutions, resolutionActions } from '@/utils/meetingWorkspace'
import { routeTabClass, routeTabsStripClass } from '@/utils/sectionTabs'
import { meetingTabFromRoute, meetingTabQuery, type MeetingTab } from '@/utils/meetingTabs'

const route = useRoute()
const { t, locale } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const isCreateResolution = computed(() => route.path === `/meetings/${id.value}/resolutions/new`)
const isDetail = computed(() => route.path === `/meetings/${id.value}` || isCreateResolution.value)
const query = useMeeting(computed(() => isDetail.value ? id.value : null))
const attachments = useMeetingAttachments(computed(() => isDetail.value ? id.value : null))
const { can } = useAccess()
const canConvert = computed(() => isDetail.value && !!query.data.value?.can_edit && can('pmo.projects.read') && can('pmo.tasks.create'))
const projectQuery = useProjects(canConvert)
const { data: projects } = projectQuery
const conversionError = ref('')
const { mutateAsync: upload, isPending: uploading } = useUploadMeetingAttachment()
const { mutateAsync: remove, isPending: deleting } = useDeleteMeetingAttachment()
const { mutateAsync: convert, isPending: converting } = useConvertResolution()
const { mutateAsync: runMeeting, isPending: transitioning } = useMeetingAction()
const { mutateAsync: runResolution } = useResolutionAction()
const backTo = computed(() => owningListBack(route.query, MEETING_LIST_PATHS, route.hash))
function childTo(path: string, query = route.query) {
  return recordChildTo(path, query, MEETING_LIST_PATHS, route.hash)
}
const projectByResolution = ref<Record<number, number>>({})
const pendingDeleteId = ref<number | null>(null)
const fileField = ref<{ reset: () => void } | null>(null)
const pendingMeetingAction = ref<{ action: 'confirm' | 'complete' | 'reopen' | 'cancel'; scope?: 'this' | 'this_and_following' } | null>(null)
const pendingResolutionAction = ref<{ resolutionId: number; action: 'start' | 'complete' | 'cancel' | 'reopen' } | null>(null)
const pendingResolutionIds = ref(new Set<number>())
const resolutionErrors = ref<Record<number, string>>({})
const recommendationSearch = ref('')
const recommendationState = ref('')
const recommendationStateSelect = computed({
  get: () => recommendationState.value || '__all__',
  set: value => { recommendationState.value = value === '__all__' ? '' : String(value) },
})
const projectSearch = ref<Record<number, string>>({})
const activeTab = computed<MeetingTab>(() => isCreateResolution.value ? 'resolutions' : meetingTabFromRoute(route.query.tab, hydrated.value ? route.hash : undefined))
const meetingTabsRoot = ref<HTMLElement | null>(null)
let activeTabScrollFrame: number | null = null
const meetingTabs = computed(() => [
  { label: t('meetingsUi.summary'), value: 'summary' },
  { label: t('meetingsUi.agenda'), value: 'agenda' },
  { label: t('meetingsUi.minutes'), value: 'minutes' },
  { label: `${t('meetingsUi.resolutions')} (${query.data.value?.resolutions.length ?? 0})`, value: 'resolutions' },
  { label: `${t('meetingsUi.attachmentsTitle')} (${attachments.data.value?.items.length ?? 0})`, value: 'attachments' },
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
  : query.data.value?.name ?? (query.error.value ? t('nav.meetings') : ''))
const historicalSnapshot = computed(() => query.data.value?.state === 'done' ? query.data.value?.minutes_snapshot ?? null : null)
const doneWithoutSnapshot = computed(() => query.data.value?.state === 'done' && !historicalSnapshot.value)
const filteredResolutions = computed(() => filterMeetingResolutions(query.data.value?.resolutions ?? [], {
  q: recommendationSearch.value,
  state: recommendationState.value,
}))
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
type VersionRow = { id: number; number: number; captured_at: string; actor: { id: number; name: string } | null; snapshot: VersionSnapshot }
const eventRows = computed(() => (eventQuery.data.value as unknown as { items: Array<{ id: number; meeting_id: number; meeting_name: string; occurred_at: string; actor: { id: number; name: string } | null; kind: string; summary: string }>; total: number } | undefined)?.items ?? [])
const eventTotal = computed(() => (eventQuery.data.value as unknown as { total?: number } | undefined)?.total ?? 0)
const versionRows = computed(() => (versionQuery.data.value as unknown as { items: VersionRow[]; total: number } | undefined)?.items ?? [])
const versionTotal = computed(() => (versionQuery.data.value as unknown as { total?: number } | undefined)?.total ?? 0)
const selectedVersion = computed(() => versionRows.value.find(version => version.id === selectedVersionId.value) ?? null)
const currentMinutesForm = computed(() => (query.data.value as typeof query.data.value & { minutes_form?: MeetingMinutesFormValue | null } | undefined)?.minutes_form ?? null)
const historicalMinutesForm = computed(() => (historicalSnapshot.value as typeof historicalSnapshot.value & { minutes_form?: MeetingMinutesFormValue | null } | null)?.minutes_form ?? null)
const historicalRecommendations = computed(() => (historicalSnapshot.value as typeof historicalSnapshot.value & { resolutions?: MeetingMinutesRecommendation[] } | null)?.resolutions ?? [])

function scrollActiveTabIntoView() {
  if (!import.meta.client || activeTabScrollFrame !== null) return
  activeTabScrollFrame = requestAnimationFrame(() => {
    activeTabScrollFrame = null
    const strip = meetingTabsRoot.value?.querySelector<HTMLElement>('nav')
    const trigger = strip?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!strip || !trigger) return
    const stripRect = strip.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    const delta = triggerRect.left < stripRect.left
      ? triggerRect.left - stripRect.left
      : triggerRect.right > stripRect.right
        ? triggerRect.right - stripRect.right
        : 0
    if (delta) strip.scrollBy({ left: delta, behavior: 'instant' })
  })
}

watch([activeTab, locale, meetingTabsRoot], scrollActiveTabIntoView, { flush: 'post' })
onMounted(scrollActiveTabIntoView)
onBeforeUnmount(() => {
  if (activeTabScrollFrame !== null) cancelAnimationFrame(activeTabScrollFrame)
  activeTabScrollFrame = null
})

function selectVersion(version: VersionRow) {
  selectedVersionId.value = version.id
}
function goToEventPage(page: number) {
  eventPage.value = page
}
function goToVersionPage(page: number) {
  versionPage.value = page
  selectedVersionId.value = null
}
watch(versionRows, rows => {
  const first = rows[0]
  if (first && !rows.some(row => row.id === selectedVersionId.value)) selectedVersionId.value = first.id
}, { immediate: true })

type ResolutionExecutionState = 'open' | 'in_progress' | 'done' | 'cancelled'

function resolutionProjection(resolution: unknown): ResolutionExecutionState {
  const value = resolution as { execution_state?: ResolutionExecutionState | null; state: ResolutionExecutionState }
  return value.execution_state || value.state
}

function taskLinked(resolution: unknown) {
  const value = resolution as { task_id?: number | null; task_linked?: boolean }
  return Boolean(value.task_id || value.task_linked)
}

function actionsFor(resolution: unknown) {
  return resolutionActions(resolution as Parameters<typeof resolutionActions>[0])
}

function projectsFor(resolutionId: number) {
  const q = projectSearch.value[resolutionId]?.trim().toLocaleLowerCase() ?? ''
  const all = projects.value ?? []
  const filtered = all.filter(project => !q || project.name.toLocaleLowerCase().includes(q))
  const selectedId = projectByResolution.value[resolutionId]
  const selected = selectedId ? all.find(project => project.id === selectedId) : undefined
  return selected && !filtered.some(project => project.id === selected.id) ? [selected, ...filtered] : filtered
}

function resolutionCanReopen(resolution: { can_edit_decision: boolean; task_id: number | null; state: 'open' | 'in_progress' | 'done' | 'cancelled' }) {
  return actionsFor(resolution).includes('reopen') && !taskLinked(resolution)
}

function localTime(value: string | null) {
  return formatLocalDateTime(value)
}

function displayValue(value: string | null | undefined) {
  return value || '—'
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !id.value) return
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = String(reader.result ?? '')
        resolve(result.slice(result.indexOf(',') + 1))
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    await upload({ meetingId: id.value, name: file.name, mimetype: file.type || undefined, data })
  } catch (error) {
    toast.add({ title: error instanceof ApiError || error instanceof Error ? error.message : t('errors.generic'), color: 'error' })
  } finally {
    input.value = ''
    fileField.value?.reset()
  }
}

async function confirmDelete(attachmentId: number) {
  if (!id.value) return
  try {
    await remove({ meetingId: id.value, attachmentId })
  } catch (error) {
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  } finally {
    pendingDeleteId.value = null
  }
}

async function convertResolution(resolutionId: number) {
  const projectId = projectByResolution.value[resolutionId]
  if (!hydrated.value || !canConvert.value || !projectId || !id.value || pendingResolutionIds.value.has(resolutionId)) return
  if (!(projects.value ?? []).some(project => project.id === projectId)) {
    projectByResolution.value = { ...projectByResolution.value, [resolutionId]: 0 }
    return
  }
  conversionError.value = ''
  pendingResolutionIds.value = new Set([...pendingResolutionIds.value, resolutionId])
  try {
    const task = await convert({ meetingId: id.value, resolutionId, projectId })
    await navigateTo(`/tasks/${task.id}`)
  } catch (error) {
    conversionError.value = error instanceof ApiError ? error.message : t('meetingsUi.convertError')
  } finally {
    const next = new Set(pendingResolutionIds.value)
    next.delete(resolutionId)
    pendingResolutionIds.value = next
  }
}

function requestMeetingAction(action: 'confirm' | 'complete' | 'reopen' | 'cancel') {
  if (!hydrated.value || transitioning.value) return
  if (action === 'cancel') pendingMeetingAction.value = query.data.value?.series_id
    ? { action, scope: 'this' }
    : { action }
  else void executeMeetingAction({ action })
}

async function executeMeetingAction(pending: { action: 'confirm' | 'complete' | 'reopen' | 'cancel'; scope?: 'this' | 'this_and_following' }) {
  if (!pending || !hydrated.value || transitioning.value || !id.value) return
  try {
    await runMeeting({ id: id.value, action: pending.action, body: pending.scope ? { scope: pending.scope } : undefined })
  } catch (error) {
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  } finally {
    pendingMeetingAction.value = null
  }
}

async function confirmMeetingAction() {
  const pending = pendingMeetingAction.value
  if (!pending) return
  await executeMeetingAction(pending)
}

function requestResolutionAction(resolutionId: number, action: 'start' | 'complete' | 'cancel' | 'reopen') {
  const resolution = query.data.value?.resolutions.find(item => item.id === resolutionId)
  if (!hydrated.value || !resolution || taskLinked(resolution) || pendingResolutionIds.value.has(resolutionId) || pendingResolutionAction.value?.resolutionId === resolutionId || !actionsFor(resolution).includes(action)) return
  if (action === 'cancel') pendingResolutionAction.value = { resolutionId, action }
  else void executeResolutionAction({ resolutionId, action })
}

async function executeResolutionAction(pending: { resolutionId: number; action: 'start' | 'complete' | 'cancel' | 'reopen' }) {
  if (!hydrated.value || !id.value || pendingResolutionIds.value.has(pending.resolutionId)) return
  pendingResolutionIds.value = new Set([...pendingResolutionIds.value, pending.resolutionId])
  try {
    await runResolution({ meetingId: id.value, resolutionId: pending.resolutionId, action: pending.action })
    resolutionErrors.value = { ...resolutionErrors.value, [pending.resolutionId]: '' }
  } catch (error) {
    resolutionErrors.value = { ...resolutionErrors.value, [pending.resolutionId]: error instanceof ApiError ? error.message : t('errors.generic') }
  } finally {
    const next = new Set(pendingResolutionIds.value)
    next.delete(pending.resolutionId)
    pendingResolutionIds.value = next
    if (pendingResolutionAction.value?.resolutionId === pending.resolutionId) pendingResolutionAction.value = null
  }
}

const pendingResolutionName = computed(() => {
  const id = pendingResolutionAction.value?.resolutionId
  return id ? query.data.value?.resolutions.find(item => item.id === id)?.name || '' : ''
})

async function confirmResolutionAction() {
  const pending = pendingResolutionAction.value
  if (!pending) return
  await executeResolutionAction(pending)
}
</script>


<template>
  <SharedRecordPage
    v-if="isDetail"
    :title="recordTitle"
    :back-to="isCreateResolution ? undefined : backTo"
    :loading="query.isLoading.value"
    :error="query.error.value"
    @retry="query.refetch()"
  >
    <template #actions>
      <UButton v-if="query.data.value?.can_edit && pendingResolutionIds.size === 0" color="neutral" variant="outline" :to="childTo(`/meetings/${id}/edit`)" :label="t('app.edit')" />
      <UButton v-if="query.data.value?.can_edit && query.data.value.state === 'draft'" :disabled="!hydrated || transitioning" :label="t('meetingsUi.confirm')" @click="requestMeetingAction('confirm')" />
      <UButton v-if="query.data.value?.can_manage && query.data.value.state === 'confirmed'" :disabled="!hydrated || transitioning" :label="t('meetingsUi.complete')" @click="requestMeetingAction('complete')" />
      <UButton v-if="query.data.value?.can_manage && (query.data.value.state === 'done' || query.data.value.state === 'cancelled')" color="neutral" variant="outline" :disabled="!hydrated || transitioning" :label="t('meetingsUi.reopen')" @click="requestMeetingAction('reopen')" />
      <!-- Secondary and destructive actions live in one menu; cancelling still asks inline below the header. -->
      <UDropdownMenu :items="moreActions" :content="{ align: 'end' }">
        <UButton color="neutral" variant="outline" square icon="i-lucide-ellipsis" :aria-label="t('app.actions')" :disabled="!hydrated" data-testid="meeting-more-actions" />
      </UDropdownMenu>
    </template>
    <template #tabs>
      <div ref="meetingTabsRoot" class="min-w-0 max-w-full">
        <!-- Record tabs first, then a divider and the log tabs (history, versions); every tab keeps its own route. -->
        <nav data-testid="meeting-tabs" :class="routeTabsStripClass" :aria-label="t('meetingsUx.sections')">
          <template v-for="(tab, index) in tabLinks" :key="tab.key">
            <span v-if="index === logTabStart" role="separator" aria-orientation="vertical" class="mx-1 my-2 w-px shrink-0 bg-accented" />
            <UButton color="neutral" variant="ghost" :class="routeTabClass" :to="tab.to" :aria-current="tab.active ? 'page' : undefined" :data-active="tab.active" :data-testid="tab.key">
              <span>{{ tab.label }}</span>
            </UButton>
          </template>
        </nav>
      </div>
    </template>

    <div v-if="query.data.value" class="grid min-w-0 gap-4">
      <SharedInlineConfirm
        v-if="pendingMeetingAction"
        color="error"
        :title="t('meetingsUx.confirmMeetingAction', { name: query.data.value.name, scope: pendingMeetingAction.scope === 'this_and_following' ? t('meetingsUi.scopeFollowing') : t('meetingsUi.scopeThis') })"
        :confirm-label="t('meetingsUi.confirm')"
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
                  <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.start') }}</dt><dd class="text-highlighted">{{ hydrated ? displayValue(localTime(query.data.value.start_datetime)) : '—' }}</dd></div>
                  <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.end') }}</dt><dd class="text-highlighted">{{ hydrated ? displayValue(localTime(query.data.value.end_datetime)) : '—' }}</dd></div>
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
        <div v-if="!historicalSnapshot && query.data.value.can_edit && pendingResolutionIds.size === 0" class="flex flex-wrap items-center justify-end gap-2"><UButton size="sm" :to="childTo(`/meetings/${id}/minutes`)" :label="t('meetingsUx.editMinutes')" /></div>
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
          @page="goToEventPage"
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
          @page="goToVersionPage"
          @select="selectVersion"
        />
        <div v-if="selectedVersion" class="flex justify-end">
          <UButton color="neutral" variant="outline" size="sm" :to="childTo(`/meetings/${id}/print`, { ...route.query, version_id: String(selectedVersion.id) })" :label="t('meetingMinutesForm.printPreview')" />
        </div>
        <MeetingMinutesDocument
          v-if="selectedVersion"
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
      <template v-else-if="activeTab === 'resolutions'">
        <section id="meeting-resolutions" aria-labelledby="meeting-resolutions-title" class="space-y-3">
          <h2 id="meeting-resolutions-title" class="sr-only">{{ t('meetingsUi.resolutions') }}</h2>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="min-w-0 text-sm text-muted">{{ t('meetingsUx.currentFollowUp') }}</p>
            <UButton v-if="query.data.value.can_edit && !['done', 'cancelled'].includes(query.data.value.state)" size="sm" :to="childTo(`/meetings/${id}/resolutions/new`, { ...route.query, tab: 'resolutions' })" :label="t('meetingsUi.newResolution')" />
          </div>
          <UCard class="min-w-0">
            <div class="grid min-w-0 gap-4">
              <FilterBar v-if="query.data.value.resolutions.length" :active-count="Number(Boolean(recommendationSearch.trim())) + Number(Boolean(recommendationState))" :disabled="!hydrated" @clear="recommendationSearch = ''; recommendationState = ''">
                <template #search><UInput v-model="recommendationSearch" :disabled="!hydrated" class="w-full" :placeholder="t('meetingsUx.searchRecommendations')" :aria-label="t('meetingsUx.searchRecommendations')" />
                </template>
                <SharedFilterChoice :disabled="!hydrated" :label="t('meetingsUi.stateLabel')" :model-value="recommendationStateSelect" :items="[{ label: t('meetingsUi.allStates'), value: '__all__' }, ...['open', 'in_progress', 'done', 'cancelled'].map(state => ({ label: t(`meetingsUi.resolutionState.${state}`), value: state }))]" @update:model-value="recommendationStateSelect = String($event)" />
                <template #active>
                  <SharedFilterChip v-if="recommendationSearch.trim()" :label="t('meetingsUi.searchValue', { value: recommendationSearch })" @remove="recommendationSearch = ''" />
                  <SharedFilterChip v-if="recommendationState" :label="t(`meetingsUi.resolutionState.${recommendationState}`)" @remove="recommendationState = ''" />
                </template>
              </FilterBar>
              <p v-if="conversionError" role="alert" class="text-sm text-error">{{ conversionError }}</p>
              <SharedEmptyState v-if="!query.data.value.resolutions.length" :title="t('meetingsUi.emptyResolutions')" />
              <SharedEmptyState v-else-if="!filteredResolutions.length" :title="t('meetingsUx.noMatchingRecommendations')" />
              <ul v-else class="grid min-w-0 gap-3">
                <li v-for="item in filteredResolutions" :key="item.id" class="grid min-w-0 gap-3 rounded-lg bg-default p-4 ring ring-default">
                  <div class="grid min-w-0 gap-2">
                    <h3 class="break-words font-semibold text-highlighted">{{ item.name }}</h3>
                    <div class="flex min-w-0 flex-wrap gap-1.5">
                      <SharedStatusBadge v-bind="resolutionStateBadgeProps(resolutionProjection(item), t)" />
                      <SharedStatusBadge v-if="resolutionProjection(item) !== item.state" v-bind="resolutionStateBadgeProps(item.state, t, t('meetingsUx.decisionState', { state: t(`meetingsUi.resolutionState.${item.state}`) }))" variant="outline" />
                      <UBadge color="neutral" variant="subtle">{{ t(`meetingsUx.priorityLabel.${item.priority}`) }}</UBadge>
                    </div>
                  </div>
                  <dl class="grid gap-4 rounded-md bg-elevated p-3 sm:grid-cols-2">
                    <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.responsible') }}</dt><dd class="break-words text-highlighted">{{ displayValue(item.responsible?.name) }}</dd></div>
                    <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.deadline') }}</dt><dd class="text-highlighted">{{ formatMeetingDate(item.deadline, locale) }}</dd></div>
                    <div v-if="item.execution_period" class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingMinutesForm.executionPeriod') }}</dt><dd class="break-words text-highlighted">{{ item.execution_period }}</dd></div>
                    <div v-if="item.project" class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingMinutesForm.project') }}</dt><dd class="break-words text-highlighted">{{ item.project.name }}</dd></div>
                  </dl>
                  <SharedRichText v-if="richTextHasContent(item.result)" :html="item.result" size="sm" />
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <template v-if="!taskLinked(item)">
                      <UButton v-if="actionsFor(item).includes('start')" size="sm" color="neutral" variant="outline" :disabled="!hydrated || pendingResolutionAction?.resolutionId === item.id || pendingResolutionIds.has(item.id)" :label="t('meetingsUi.startWork')" @click="requestResolutionAction(item.id, 'start')" />
                      <UButton v-if="actionsFor(item).includes('complete')" size="sm" :disabled="!hydrated || pendingResolutionAction?.resolutionId === item.id || pendingResolutionIds.has(item.id)" :label="t('meetingsUi.complete')" @click="requestResolutionAction(item.id, 'complete')" />
                      <UButton v-if="actionsFor(item).includes('cancel')" size="sm" color="neutral" variant="outline" :disabled="!hydrated || pendingResolutionAction?.resolutionId === item.id || pendingResolutionIds.has(item.id)" :label="t('meetingsUi.cancelMeeting')" @click="requestResolutionAction(item.id, 'cancel')" />
                    </template>
                    <UButton v-if="item.task_id" color="primary" variant="link" size="sm" class="p-0" :to="`/tasks/${item.task_id}`" :label="t('meetingsUi.openTask')" />
                    <span v-else-if="taskLinked(item)" class="text-xs text-muted">{{ t('meetingsUx.taskLinkedUnavailable') }}</span>
                    <UButton v-if="!taskLinked(item) && (item.can_edit_decision || item.can_update_execution) && !pendingResolutionIds.has(item.id)" color="neutral" variant="outline" size="sm" :to="childTo(`/meetings/${id}/resolutions/${item.id}/edit`)" :label="t('meetingsUi.editResolution')" />
                    <UButton v-if="resolutionCanReopen(item)" size="sm" color="neutral" variant="outline" :disabled="!hydrated || pendingResolutionIds.has(item.id)" :label="t('meetingsUi.reopen')" @click="requestResolutionAction(item.id, 'reopen')" />
                  </div>
                  <p v-if="resolutionErrors[item.id]" role="alert" class="text-sm text-error">{{ resolutionErrors[item.id] }}</p>
                  <SharedInlineConfirm
                    v-if="pendingResolutionAction?.resolutionId === item.id"
                    color="error"
                    :title="t('meetingsUx.confirmResolutionAction', { name: pendingResolutionName })"
                    :confirm-label="t('meetingsUi.confirm')"
                    :pending="pendingResolutionIds.has(item.id)"
                    @cancel="pendingResolutionAction = null"
                    @confirm="confirmResolutionAction"
                  />
                  <p v-if="item.task_id" class="text-xs text-muted">{{ t('meetingsUi.followedAsTask') }}</p>
                  <details v-if="!taskLinked(item) && !resolutionCanReopen(item) && canConvert && item.can_edit_decision" class="min-w-0 border-t border-default pt-3">
                    <summary class="w-fit max-w-full cursor-pointer text-sm font-medium text-primary">{{ t('meetingsUi.conversionTitle') }}</summary>
                    <div class="mt-3 grid min-w-0 gap-2">
                      <label :for="`meeting-project-${item.id}`" class="text-sm font-medium text-highlighted">{{ t('meetingsUi.chooseProject') }}</label>
                      <div class="flex min-w-0 flex-wrap items-center gap-2">
                        <UInput v-model="projectSearch[item.id]" class="min-w-0 grow basis-full sm:basis-56" :placeholder="t('meetingsUx.searchProjects')" :aria-label="t('meetingsUx.searchProjects')" :disabled="!hydrated || converting || pendingResolutionIds.has(item.id)" />
                        <USelect :id="`meeting-project-${item.id}`" :model-value="projectByResolution[item.id] ? String(projectByResolution[item.id]) : '__none__'" class="min-w-0 grow basis-full sm:basis-56" :disabled="!hydrated || converting || pendingResolutionIds.has(item.id)" :items="[{ label: t('meetingsUi.project'), value: '__none__' }, ...projectsFor(item.id).map(project => ({ label: project.name, value: String(project.id) }))]" @update:model-value="value => { projectByResolution[item.id] = value === '__none__' ? 0 : Number(value) }" />
                        <UButton size="sm" :disabled="!hydrated || converting || pendingResolutionIds.has(item.id) || !projectByResolution[item.id]" :label="t('meetingsUi.convert')" @click="convertResolution(item.id)" />
                      </div>
                      <p v-if="projectQuery.isLoading.value" role="status" class="text-xs text-muted">{{ t('meetingsUx.projectsLoading') }}</p>
                      <p v-else-if="projectQuery.error.value" role="alert" class="text-xs text-error">{{ t('meetingsUx.projectsError') }}</p>
                      <p class="text-xs text-muted">{{ t('meetingsUi.conversionHelp') }}</p>
                    </div>
                  </details>
                </li>
              </ul>
            </div>
          </UCard>
        </section>
        <SharedRecordSection v-if="query.data.value.previous_resolutions.length" id="meeting-follow-up" :title="t('meetingsUi.previousResolutions')" :description="t('meetingsUx.currentPreviousFollowUp')">
          <UCard class="min-w-0">
            <ul class="grid min-w-0 divide-y divide-default">
              <li v-for="item in query.data.value.previous_resolutions" :key="item.id" class="grid min-w-0 gap-2 py-3 first:pt-0 last:pb-0">
                <UButton color="primary" variant="link" class="w-fit p-0 font-medium whitespace-normal text-start" :to="`/meetings/${item.meeting_id}`">{{ item.meeting_name }}</UButton>
                <div class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <span class="text-highlighted">{{ item.name }}</span>
                  <span class="text-xs text-muted">{{ t('meetingsUx.currentFollowUpOrigin', { name: item.meeting_name }) }}</span>
                  <SharedStatusBadge v-bind="resolutionStateBadgeProps(item.state, t)" />
                  <span class="text-muted">{{ formatMeetingDate(item.deadline, locale) }}</span>
                </div>
                <SharedRichText v-if="richTextHasContent(item.result)" :html="item.result" size="sm" />
                <UButton v-if="item.task_id" color="primary" variant="link" size="sm" class="w-fit p-0" :to="`/tasks/${item.task_id}`" :label="t('meetingsUi.openTask')" />
              </li>
            </ul>
          </UCard>
        </SharedRecordSection>
      </template>
      <template v-else-if="activeTab === 'attachments'">
        <section id="meeting-attachments" aria-labelledby="meeting-attachments-title">
          <h2 id="meeting-attachments-title" class="sr-only">{{ t('meetingsUi.attachmentsTitle') }}</h2>
          <UCard class="min-w-0">
            <SharedPageState :loading="attachments.isLoading.value" :error="attachments.error.value" :empty="!attachments.data.value?.items.length" :empty-text="t('meetingsUi.emptyAttachments')" @retry="() => attachments.refetch()">
              <ul class="grid min-w-0 divide-y divide-default">
                <li v-for="attachment in attachments.data.value?.items" :key="attachment.id" class="flex min-w-0 flex-wrap items-center gap-2 py-2">
                  <UButton color="primary" variant="link" class="min-w-0 flex-1 justify-start p-0" :to="attachment.url" external target="_blank" rel="noopener" :label="attachment.name" />
                  <UButton v-if="query.data.value.can_edit && pendingDeleteId !== attachment.id" type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="t('attachments.delete')" :disabled="!hydrated || deleting || pendingDeleteId !== null" @click="pendingDeleteId = attachment.id" />
                  <SharedInlineConfirm
                    v-if="pendingDeleteId === attachment.id"
                    class="basis-full"
                    color="error"
                    :title="t('attachments.deleteConfirm')"
                    :confirm-label="t('attachments.confirm')"
                    :cancel-label="t('attachments.cancel')"
                    :pending="deleting"
                    @cancel="pendingDeleteId = null"
                    @confirm="confirmDelete(attachment.id)"
                  />
                </li>
              </ul>
            </SharedPageState>
            <div v-if="query.data.value.can_edit" class="mt-4 grid min-w-0 gap-2 border-t border-default pt-4">
              <label for="meeting-attachment-upload" class="text-sm font-medium text-highlighted">{{ t('meetingsUi.uploadAttachment') }}</label>
              <SharedFileField id="meeting-attachment-upload" ref="fileField" class="w-full" :disabled="!hydrated || uploading" @change="onFileChange" />
              <p class="text-xs text-muted">{{ t('meetingsUi.attachmentHelp') }}</p>
            </div>
          </UCard>
        </section>
      </template>

    </div>

    <template v-if="query.data.value" #aside>
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
