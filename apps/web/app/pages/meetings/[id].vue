<script setup lang="ts">
import FilterBar from '@/components/shared/FilterBar.vue'
import MeetingEventList from '@/components/meetings/MeetingEventList.vue'
import MeetingMinutesDocument from '@/components/meetings/MeetingMinutesDocument.vue'
import MeetingVersionList from '@/components/meetings/MeetingVersionList.vue'
import { formatMeetingDate, type MeetingMinutesFormValue, type MeetingMinutesRecommendation } from '@/components/meetings/meetingMinutesForm'
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
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
import { formatLocalDateTime } from '@/utils/meetingDateTime'
import { STATUS_COLOR } from '@/utils/statusTone'
import { filterMeetingResolutions, resolutionActions } from '@/utils/meetingWorkspace'
import { isMeetingTab, meetingTabFromRoute, meetingTabQuery, type MeetingTab } from '@/utils/meetingTabs'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const isDetail = computed(() => route.path === `/meetings/${id.value}`)
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
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/meetings', ['/meetings']))
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
const activeTab = computed<MeetingTab>(() => meetingTabFromRoute(route.query.tab, hydrated.value ? route.hash : undefined))
const meetingTabsRoot = ref<HTMLElement | null>(null)
let activeTabScrollFrame: number | null = null
const meetingTabs = computed(() => [
  { label: t('meetingsUi.summary'), value: 'summary', slot: 'summary', disabled: !hydrated.value },
  { label: t('meetingsUi.agenda'), value: 'agenda', slot: 'agenda', disabled: !hydrated.value },
  { label: t('meetingsUi.minutes'), value: 'minutes', slot: 'minutes', disabled: !hydrated.value },
  { label: `${t('meetingsUi.resolutions')} (${query.data.value?.resolutions.length ?? 0})`, value: 'resolutions', slot: 'resolutions', disabled: !hydrated.value },
  { label: `${t('meetingsUi.attachmentsTitle')} (${attachments.data.value?.items.length ?? 0})`, value: 'attachments', slot: 'attachments', disabled: !hydrated.value },
  { label: t('meetingMinutesForm.history'), value: 'history', slot: 'history', disabled: !hydrated.value },
  { label: t('meetingMinutesForm.versions'), value: 'versions', slot: 'versions', disabled: !hydrated.value },
])
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

async function onTabChange(value: unknown) {
  if (!hydrated.value || !isMeetingTab(value) || value === activeTab.value) return
  await router.push({ query: meetingTabQuery(route.query, value), hash: '' })
}

function scrollActiveTabIntoView() {
  if (!import.meta.client || activeTabScrollFrame !== null) return
  activeTabScrollFrame = requestAnimationFrame(() => {
    activeTabScrollFrame = null
    const root = meetingTabsRoot.value
    const tabList = root?.querySelector<HTMLElement>('.meeting-tabs-viewport')
    const trigger = tabList?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (!tabList || !trigger) return
    const listRect = tabList.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    const delta = triggerRect.left < listRect.left
      ? triggerRect.left - listRect.left
      : triggerRect.right > listRect.right
        ? triggerRect.right - listRect.right
        : 0
    if (delta) tabList.scrollBy({ left: delta, behavior: 'instant' })
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

function hasRichText(value: string | null | undefined) {
  return Boolean(value?.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() || /<(img|table|video|iframe)\b/i.test(value || ''))
}

function meetingStateColor(state: 'draft' | 'confirmed' | 'done' | 'cancelled') {
  return state === 'done' ? STATUS_COLOR.success
    : state === 'cancelled' ? STATUS_COLOR.destructive
      : state === 'confirmed' ? STATUS_COLOR.info
        : STATUS_COLOR.neutral
}

function resolutionStateColor(state: 'open' | 'in_progress' | 'done' | 'cancelled') {
  return state === 'done' ? STATUS_COLOR.success
    : state === 'cancelled' ? STATUS_COLOR.destructive
      : state === 'in_progress' ? STATUS_COLOR.warning
        : STATUS_COLOR.info
}

function errorMessage(error: unknown) {
  return error instanceof ApiError || error instanceof Error ? error.message : t('errors.generic')
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
  <SharedPageContainer v-if="isDetail" width="detail">
    <SharedPageHeader :title="query.data.value?.name || t('nav.meetings')" :back-to="backTo">
      <template #title>
        <span class="meeting-title">
          <span class="min-w-0">{{ query.data.value?.name || t('nav.meetings') }}</span>
          <UBadge v-if="query.data.value" :color="meetingStateColor(query.data.value.state)" variant="subtle">
            {{ t('meetingsUi.state.' + query.data.value.state) }}
          </UBadge>
          <span v-if="query.data.value?.reference" class="meeting-reference" dir="ltr">{{ query.data.value.reference }}</span>
        </span>
      </template>
      <template #actions>
        <UButton color="secondary" variant="outline" :to="{ path: `/meetings/${id}/print`, query: { ...returnToQuery(route.fullPath) } }" :label="t('meetingMinutesForm.printPreview')" />
        <UButton v-if="query.data.value?.can_edit && pendingResolutionIds.size === 0" color="secondary" variant="outline" :to="{ path: `/meetings/${id}/edit`, query: returnToQuery(route.fullPath) }" :label="t('app.edit')" />
        <UButton v-if="query.data.value?.can_edit && query.data.value.state === 'draft'" :disabled="!hydrated || transitioning" :label="t('meetingsUi.confirm')" @click="requestMeetingAction('confirm')" />
        <UButton v-if="query.data.value?.can_manage && query.data.value.state === 'confirmed'" :disabled="!hydrated || transitioning" :label="t('meetingsUi.complete')" @click="requestMeetingAction('complete')" />
        <UButton v-if="query.data.value?.can_manage && query.data.value.state !== 'cancelled' && query.data.value.state !== 'done'" color="secondary" variant="outline" :disabled="!hydrated || transitioning" :label="t('meetingsUi.cancelMeeting')" @click="requestMeetingAction('cancel')" />
        <UButton v-if="query.data.value?.can_manage && (query.data.value.state === 'done' || query.data.value.state === 'cancelled')" color="secondary" variant="outline" :disabled="!hydrated || transitioning" :label="t('meetingsUi.reopen')" @click="requestMeetingAction('reopen')" />
      </template>
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <div v-if="query.data.value" class="meeting-detail-stack">
        <UCard v-if="pendingMeetingAction" class="grid gap-3 border-error" role="alert">
          <p>{{ t('meetingsUx.confirmMeetingAction', { name: query.data.value.name, scope: pendingMeetingAction.scope === 'this_and_following' ? t('meetingsUi.scopeFollowing') : t('meetingsUi.scopeThis') }) }}</p>
          <USelect v-if="pendingMeetingAction.action === 'cancel' && query.data.value.series_id" v-model="pendingMeetingAction.scope" class="w-full" :disabled="transitioning" :items="[{ label: t('meetingsUi.scopeThis'), value: 'this' }, { label: t('meetingsUi.scopeFollowing'), value: 'this_and_following' }]" />
          <div class="flex gap-2">
            <UButton type="button" color="secondary" variant="outline" :label="t('app.cancel')" @click="pendingMeetingAction = null" />
            <UButton type="button" color="error" :disabled="!hydrated || transitioning" :label="t('meetingsUi.confirm')" @click="confirmMeetingAction" />
          </div>
        </UCard>
        <div ref="meetingTabsRoot" class="min-w-0 max-w-full" :dir="locale === 'ar' ? 'rtl' : 'ltr'">
        <UTabs
          :model-value="activeTab"
          :items="meetingTabs"
          class="meeting-tabs"
          :ui="{ list: 'meeting-tabs-viewport meeting-tabs-list', trigger: 'meeting-tabs-trigger', label: 'meeting-tabs-label', content: 'meeting-tab-panel' }"
          :aria-label="t('meetingsUx.sections')"
          @update:model-value="onTabChange"
        >
        <template #summary>
          <UCard id="meeting-summary" class="meeting-summary">
          <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('meetingsUi.summary') }}</h2></template>
          <div>
            <div class="meeting-summary-grid">
              <section class="meeting-summary-group">
                <h3 class="meeting-subheading">{{ t('meetingsUi.sectionSchedule') }}</h3>
                <dl class="meeting-meta-grid">
                  <div class="meeting-meta-item"><dt>{{ t('meetingsUi.date') }}</dt><dd>{{ formatMeetingDate(query.data.value.meeting_date, locale) }}</dd></div>
                  <div class="meeting-meta-item"><dt>{{ t('meetingsUi.start') }}</dt><dd>{{ hydrated ? displayValue(localTime(query.data.value.start_datetime)) : '—' }}</dd></div>
                  <div class="meeting-meta-item"><dt>{{ t('meetingsUi.end') }}</dt><dd>{{ hydrated ? displayValue(localTime(query.data.value.end_datetime)) : '—' }}</dd></div>
                  <div class="meeting-meta-item"><dt>{{ t('meetingsUi.location') }}</dt><dd>{{ displayValue(query.data.value.location) }}</dd></div>
                  <div v-if="query.data.value.meeting_url" class="meeting-meta-item"><dt>{{ t('meetingsUi.url') }}</dt><dd><a :href="query.data.value.meeting_url" target="_blank" rel="noopener" class="break-all text-brand-link underline" dir="ltr">{{ query.data.value.meeting_url }}</a></dd></div>
                </dl>
              </section>
              <section class="meeting-summary-group">
                <h3 class="meeting-subheading">{{ t('meetingsUi.sectionPeople') }}</h3>
                <dl class="meeting-meta-grid">
                  <div class="meeting-meta-item"><dt>{{ t('meetingsUi.organizer') }}</dt><dd>{{ displayValue(query.data.value.organizer?.name) }}</dd></div>
                  <div class="meeting-meta-item"><dt>{{ t('meetingsUi.secretary') }}</dt><dd>{{ displayValue(query.data.value.secretary?.name) }}</dd></div>
                  <div v-if="query.data.value.series" class="meeting-meta-item"><dt>{{ t('meetingsUi.series') }}</dt><dd><NuxtLink :to="`/meetings/series/${query.data.value.series.id}`" class="text-brand-link">{{ query.data.value.series.name }}</NuxtLink></dd></div>
                </dl>
                <div class="meeting-attendees">
                  <ul v-if="query.data.value.attendees.length" class="meeting-attendee-list">
                    <li v-for="person in query.data.value.attendees" :key="person.id" class="min-w-0 max-w-full"><UBadge color="neutral" variant="subtle" class="max-w-full whitespace-normal break-words text-start">{{ person.name }}</UBadge></li>
                  </ul>
                  <p v-else class="meeting-empty">{{ t('meetingsUi.emptyAttendees') }}</p>
                </div>
              </section>
            </div>
          </div>
          </UCard>
          </template>
        <template #agenda>
          <UCard id="meeting-agenda" class="meeting-rich-panel">
            <template #header>
              <h2>{{ t('meetingsUi.agenda') }}</h2>
              <span v-if="historicalSnapshot" class="text-xs text-muted-foreground">{{ t('meetingsUx.historicalMinutesTitle') }}</span>
            </template>
            <div>
              <p v-if="doneWithoutSnapshot" class="mb-3 text-xs text-muted-foreground">{{ t('meetingsUx.historyUnavailable') }} {{ t('meetingsUx.currentContentAfterMissingHistory') }}</p>
              <div v-if="hasRichText(historicalSnapshot ? historicalSnapshot.agenda : query.data.value.agenda)" class="meeting-rich-text" v-html="historicalSnapshot ? historicalSnapshot.agenda : query.data.value.agenda" />
              <p v-else class="meeting-empty">{{ t('meetingsUi.emptyAgenda') }}</p>
            </div>
          </UCard>
        </template>
        <template #minutes>
          <div class="flex flex-wrap items-center justify-end gap-2"><UButton v-if="!historicalSnapshot && query.data.value.can_edit && pendingResolutionIds.size === 0" size="sm" :to="{ path: `/meetings/${id}/minutes`, query: returnToQuery(route.fullPath) }" :label="t('meetingsUx.editMinutes')" /></div>
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
          <UCard v-if="!historicalSnapshot && !currentMinutesForm" id="meeting-minutes" class="meeting-rich-panel">
            <template #header>
              <h2>{{ t('meetingsUi.minutes') }}</h2>
            </template>
            <div>
              <p v-if="doneWithoutSnapshot" class="mb-3 text-xs text-muted-foreground">{{ t('meetingsUx.historyUnavailable') }} {{ t('meetingsUx.currentContentAfterMissingHistory') }}</p>
              <div v-if="hasRichText(query.data.value.minutes)" class="meeting-rich-text" v-html="query.data.value.minutes" />
              <p v-else class="meeting-empty">{{ t('meetingsUi.emptyMinutes') }}</p>
            </div>
          </UCard>
          <UCard v-if="historicalSnapshot" id="meeting-snapshot" class="meeting-section">
            <template #header>
              <h2>{{ t('meetingsUx.historicalDecisionStates') }}</h2>
              <span class="text-xs text-muted-foreground">{{ t('meetingsUx.historicalMinutesTitle') }}</span>
            </template>
            <div class="grid gap-4">
              <div v-if="historicalSnapshot.resolutions.length" class="grid gap-2">
                <div v-for="item in historicalSnapshot.resolutions" :key="item.id" class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <span class="font-medium">{{ item.name }}</span>
                  <span v-if="item.meeting_name" class="text-xs text-muted-foreground">{{ t('meetingsUx.snapshotOrigin', { name: item.meeting_name }) }}</span>
                  <UBadge color="neutral" variant="outline">{{ t(`meetingsUi.resolutionState.${item.state}`) }}</UBadge>
                  <span v-if="item.result && hasRichText(item.result)" class="meeting-rich-text" v-html="item.result" />
                </div>
              </div>
              <p v-else class="text-sm text-muted-foreground">{{ t('meetingsUi.emptyResolutions') }}</p>
            </div>
          </UCard>
        </template>
        <template #history>
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
        <template #versions>
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
            <UButton color="secondary" variant="outline" size="sm" :to="{ path: `/meetings/${id}/print`, query: { ...returnToQuery(route.fullPath), version_id: selectedVersion.id } }" :label="t('meetingMinutesForm.printPreview')" />
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
        <template #resolutions>
        <UCard id="meeting-resolutions" class="meeting-section">
          <template #header>
            <div class="flex min-w-0 flex-wrap items-center gap-2"><h2 class="text-lg font-semibold text-highlighted">{{ t('meetingsUi.resolutions') }}</h2><UBadge color="neutral" variant="subtle">{{ query.data.value.resolutions.length }}</UBadge><span class="text-xs text-muted">{{ t('meetingsUx.currentFollowUp') }}</span><UButton v-if="query.data.value.can_edit && !['done', 'cancelled'].includes(query.data.value.state)" size="sm" :to="{ path: `/meetings/${id}/resolutions/new`, query: returnToQuery(route.fullPath) }" :label="t('meetingsUi.newResolution')" /></div>
          </template>
          <div>
            <FilterBar v-if="query.data.value.resolutions.length" class="mb-4" :active-count="Number(Boolean(recommendationSearch.trim())) + Number(Boolean(recommendationState))" :disabled="!hydrated" @clear="recommendationSearch = ''; recommendationState = ''">
              <template #search><UInput :disabled="!hydrated" v-model="recommendationSearch" class="w-full" :placeholder="t('meetingsUx.searchRecommendations')" :aria-label="t('meetingsUx.searchRecommendations')" /></template>
              <USelect :disabled="!hydrated" v-model="recommendationStateSelect" class="w-full" :items="[{ label: t('meetingsUi.allStates'), value: '__all__' }, ...['open', 'in_progress', 'done', 'cancelled'].map(state => ({ label: t(`meetingsUi.resolutionState.${state}`), value: state }))]" :aria-label="t('meetingsUi.stateLabel')" />

            <template #active>
              <UBadge v-if="recommendationSearch.trim()" color="neutral" variant="subtle">{{ recommendationSearch }}</UBadge>
              <UBadge v-if="recommendationState" color="neutral" variant="subtle">{{ t(`meetingsUi.resolutionState.${recommendationState}`) }}</UBadge>
            </template>
          </FilterBar>
            <p v-if="conversionError" role="alert" class="text-sm text-destructive">{{ conversionError }}</p>
            <p v-if="!query.data.value.resolutions.length" class="meeting-empty">{{ t('meetingsUi.emptyResolutions') }}</p>
            <p v-else-if="!filteredResolutions.length" class="meeting-empty">{{ t('meetingsUx.noMatchingRecommendations') }}</p>
            <ul v-else class="meeting-resolution-list">
            <li v-for="item in filteredResolutions" :key="item.id" class="meeting-resolution-card">
              <div class="meeting-resolution-head">
                <h3 class="meeting-resolution-title">{{ item.name }}</h3>
                <div class="meeting-resolution-badges">
                  <UBadge :color="resolutionStateColor(resolutionProjection(item))" variant="subtle">{{ t(`meetingsUi.resolutionState.${resolutionProjection(item)}`) }}</UBadge>
                  <UBadge v-if="resolutionProjection(item) !== item.state" color="neutral" variant="outline">{{ t('meetingsUx.decisionState', { state: t(`meetingsUi.resolutionState.${item.state}`) }) }}</UBadge>
                  <UBadge color="neutral" variant="subtle">{{ t(`meetingsUx.priorityLabel.${item.priority}`) }}</UBadge>
                </div>
              </div>
              <dl class="meeting-resolution-meta">
                <div><dt>{{ t('meetingsUi.responsible') }}</dt><dd>{{ displayValue(item.responsible?.name) }}</dd></div>
                <div><dt>{{ t('meetingsUi.deadline') }}</dt><dd>{{ formatMeetingDate(item.deadline, locale) }}</dd></div>
                <div v-if="item.execution_period"><dt>{{ t('meetingMinutesForm.executionPeriod') }}</dt><dd>{{ item.execution_period }}</dd></div>
                <div v-if="item.project"><dt>{{ t('meetingMinutesForm.project') }}</dt><dd>{{ item.project.name }}</dd></div>
              </dl>
              <div v-if="hasRichText(item.result)" class="meeting-rich-text meeting-resolution-result" v-html="item.result" />
              <div class="meeting-resolution-actions">
                <template v-if="!taskLinked(item)">
                <UButton v-if="actionsFor(item).includes('start')" size="sm" color="secondary" variant="outline" :disabled="!hydrated || pendingResolutionAction?.resolutionId === item.id || pendingResolutionIds.has(item.id)" :label="t('meetingsUi.startWork')" @click="requestResolutionAction(item.id, 'start')" />
                <UButton v-if="actionsFor(item).includes('complete')" size="sm" :disabled="!hydrated || pendingResolutionAction?.resolutionId === item.id || pendingResolutionIds.has(item.id)" :label="t('meetingsUi.complete')" @click="requestResolutionAction(item.id, 'complete')" />
                <UButton v-if="actionsFor(item).includes('cancel')" size="sm" color="secondary" variant="outline" :disabled="!hydrated || pendingResolutionAction?.resolutionId === item.id || pendingResolutionIds.has(item.id)" :label="t('meetingsUi.cancelMeeting')" @click="requestResolutionAction(item.id, 'cancel')" />
                </template>
                <UButton v-if="item.task_id" variant="link" size="sm" class="h-auto p-0" :to="`/tasks/${item.task_id}`" :label="t('meetingsUi.openTask')" />
                <span v-else-if="taskLinked(item)" class="text-xs text-muted-foreground">{{ t('meetingsUx.taskLinkedUnavailable') }}</span>
                <UButton v-if="!taskLinked(item) && (item.can_edit_decision || item.can_update_execution) && !pendingResolutionIds.has(item.id)" color="secondary" variant="outline" size="sm" :to="{ path: `/meetings/${id}/resolutions/${item.id}/edit`, query: returnToQuery(route.fullPath) }" :label="t('meetingsUi.editResolution')" />
                <UButton v-if="resolutionCanReopen(item)" size="sm" color="secondary" variant="outline" :disabled="!hydrated || pendingResolutionIds.has(item.id)" :label="t('meetingsUi.reopen')" @click="requestResolutionAction(item.id, 'reopen')" />
              </div>
              <p v-if="resolutionErrors[item.id]" role="alert" class="text-sm text-destructive">{{ resolutionErrors[item.id] }}</p>
              <div v-if="pendingResolutionAction?.resolutionId === item.id" class="meeting-inline-confirm" role="alert">
                  <span class="text-sm">{{ t('meetingsUx.confirmResolutionAction', { name: pendingResolutionName }) }}</span>
                <div class="flex flex-wrap gap-2">
                  <UButton type="button" color="secondary" variant="outline" size="sm" :disabled="pendingResolutionAction ? pendingResolutionIds.has(pendingResolutionAction.resolutionId) : false" :label="t('app.cancel')" @click="pendingResolutionAction = null" />
                  <UButton type="button" color="error" size="sm" :disabled="!hydrated || (pendingResolutionAction ? pendingResolutionIds.has(pendingResolutionAction.resolutionId) : false)" :label="t('meetingsUi.confirm')" @click="confirmResolutionAction" />
                </div>
              </div>
              <p v-if="item.task_id" class="text-xs text-muted-foreground">{{ t('meetingsUi.followedAsTask') }}</p>
              <details v-if="!taskLinked(item) && !resolutionCanReopen(item) && canConvert && item.can_edit_decision" class="meeting-conversion">
                <summary>{{ t('meetingsUi.conversionTitle') }}</summary>
                <div class="meeting-conversion-body">
                  <label :for="`meeting-project-${item.id}`" class="text-sm font-medium">{{ t('meetingsUi.chooseProject') }}</label>
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <UInput v-model="projectSearch[item.id]" class="meeting-project-select" :placeholder="t('meetingsUx.searchProjects')" :aria-label="t('meetingsUx.searchProjects')" :disabled="!hydrated || converting || pendingResolutionIds.has(item.id)" />
                    <USelect :id="`meeting-project-${item.id}`" :model-value="projectByResolution[item.id] ? String(projectByResolution[item.id]) : '__none__'" class="meeting-project-select w-full min-w-0 max-w-full" :disabled="!hydrated || converting || pendingResolutionIds.has(item.id)" :items="[{ label: t('meetingsUi.project'), value: '__none__' }, ...projectsFor(item.id).map(project => ({ label: project.name, value: String(project.id) }))]" @update:model-value="value => { projectByResolution[item.id] = value === '__none__' ? 0 : Number(value) }" />
                    <UButton size="sm" :disabled="!hydrated || converting || pendingResolutionIds.has(item.id) || !projectByResolution[item.id]" :label="t('meetingsUi.convert')" @click="convertResolution(item.id)" />
                  </div>
                  <p v-if="projectQuery.isLoading.value" class="text-xs text-muted-foreground">{{ t('meetingsUx.projectsLoading') }}</p>
                  <p v-else-if="projectQuery.error.value" class="text-xs text-destructive">{{ t('meetingsUx.projectsError') }}</p>
                  <p class="text-xs text-muted-foreground">{{ t('meetingsUi.conversionHelp') }}</p>
                </div>
              </details>
            </li>
            </ul>
          </div>
        </UCard>
        <UCard v-if="query.data.value.previous_resolutions.length" id="meeting-follow-up">
          <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('meetingsUi.previousResolutions') }}</h2><span class="text-xs text-muted">{{ t('meetingsUx.currentPreviousFollowUp') }}</span></template>
          <div class="grid gap-3">
          <div v-for="item in query.data.value.previous_resolutions" :key="item.id" class="meeting-previous-row">
            <NuxtLink :to="{ path: `/meetings/${item.meeting_id}`, query: returnToQuery(route.fullPath) }" class="font-medium text-brand-link">{{ item.meeting_name }}</NuxtLink>
            <div class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <span>{{ item.name }}</span>
              <span class="text-xs text-muted-foreground">{{ t('meetingsUx.currentFollowUpOrigin', { name: item.meeting_name }) }}</span>
              <UBadge :color="resolutionStateColor(item.state)" variant="subtle">{{ t(`meetingsUi.resolutionState.${item.state}`) }}</UBadge>
              <span>{{ formatMeetingDate(item.deadline, locale) }}</span>
            </div>
            <div v-if="hasRichText(item.result)" class="meeting-rich-text" v-html="item.result" />
            <UButton v-if="item.task_id" variant="link" size="sm" class="h-auto w-fit p-0" :to="`/tasks/${item.task_id}`" :label="t('meetingsUi.openTask')" />
          </div>
          </div>
        </UCard>
        </template>
        <template #attachments>
        <UCard id="meeting-attachments" class="meeting-section">
          <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('meetingsUi.attachmentsTitle') }}</h2></template>
          <div>
          <div v-if="attachments.error.value" class="meeting-inline-error" role="alert">
            <p class="text-sm text-destructive">{{ errorMessage(attachments.error.value) }}</p>
            <UButton type="button" color="secondary" variant="outline" size="sm" :disabled="!hydrated || attachments.isFetching.value" :label="t('app.retry')" @click="() => attachments.refetch()" />
          </div>
          <p v-else-if="attachments.isLoading.value" class="meeting-empty">{{ t('attachments.loading') }}</p>
          <ul v-else-if="attachments.data.value?.items.length" class="meeting-attachment-list">
            <li v-for="attachment in attachments.data.value.items" :key="attachment.id" class="meeting-attachment-row">
              <a :href="attachment.url" class="min-w-0 flex-1 truncate text-brand-link underline" target="_blank" rel="noopener">{{ attachment.name }}</a>
              <UButton v-if="query.data.value.can_edit && pendingDeleteId !== attachment.id" type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="t('attachments.delete')" :disabled="!hydrated || deleting || pendingDeleteId !== null" @click="pendingDeleteId = attachment.id" />
              <div v-if="pendingDeleteId === attachment.id" class="meeting-inline-confirm" role="group" :aria-label="t('attachments.deleteConfirm')">
                <span class="text-sm text-muted-foreground">{{ t('attachments.deleteConfirm') }}</span>
                <div class="flex flex-wrap gap-2">
                  <UButton type="button" color="secondary" variant="outline" size="sm" :disabled="!hydrated || deleting" :label="t('attachments.cancel')" @click="pendingDeleteId = null" />
                  <UButton type="button" color="error" size="sm" :disabled="!hydrated || deleting" :label="t('attachments.confirm')" @click="confirmDelete(attachment.id)" />
                </div>
              </div>
            </li>
          </ul>
          <p v-else class="meeting-empty">{{ t('meetingsUi.emptyAttachments') }}</p>
          <div v-if="query.data.value.can_edit" class="meeting-upload">
            <label for="meeting-attachment-upload" class="text-sm font-medium text-highlighted">{{ t('meetingsUi.uploadAttachment') }}</label>
            <SharedFileField ref="fileField" id="meeting-attachment-upload" class="w-full" :disabled="!hydrated || uploading" @change="onFileChange" />
            <p class="text-xs text-muted-foreground">{{ t('meetingsUi.attachmentHelp') }}</p>
          </div>
          </div>
        </UCard>
        </template>
        </UTabs>
        </div>
      </div>
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage v-else />
</template>

<style scoped>
.meeting-title {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.meeting-reference {
  color: var(--muted-foreground);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.04em;
}

.meeting-detail-stack {
  display: grid;
  min-width: 0;
  gap: 16px;
  container: meeting-detail / inline-size;
}

.meeting-tabs { min-width: 0; }
.meeting-tabs :deep(.meeting-tabs-viewport) { min-width: 0; max-width: 100%; overflow-x: auto; }
.meeting-tabs :deep(.meeting-tabs-list) { flex-wrap: nowrap; width: 100%; }
.meeting-tabs :deep(.meeting-tabs-trigger) { flex: 0 0 auto; min-width: max-content; white-space: nowrap; }
.meeting-tabs :deep(.meeting-tabs-label) { max-width: none; overflow: visible; text-overflow: clip; white-space: nowrap; }
.meeting-tab-panel { display: grid; min-width: 0; gap: 16px; }

.meeting-summary,
.meeting-section,
.meeting-rich-panel {
  min-width: 0;
}

.meeting-summary { container: meeting-summary / inline-size; }

.meeting-summary-grid {
  display: grid;
  min-width: 0;
  gap: 20px 28px;
}

.meeting-summary-group { min-width: 0; }
.meeting-summary-group > .meeting-subheading { margin-block-end: 4px; }

.meeting-meta-grid {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  gap: 0 24px;
}

.meeting-meta-item,
.meeting-resolution-meta > div {
  display: grid;
  min-width: 0;
  gap: 3px;
  padding-block: 9px;
  border-block-end: 1px solid var(--border);
}

.meeting-meta-item dt,
.meeting-resolution-meta dt {
  color: var(--muted-foreground);
  font-size: 0.75rem;
}

.meeting-meta-item dd,
.meeting-resolution-meta dd {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 0.875rem;
  font-weight: 600;
}

.meeting-meta-item:last-child,
.meeting-resolution-meta > div:last-child {
  border-block-end: 0;
}

.meeting-attendees {
  margin-block-start: 16px;
  padding-block-start: 16px;
  border-block-start: 1px solid var(--border);
}

.meeting-subheading,
.meeting-section-title {
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.4;
}

.meeting-attendee-list {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 8px;
  margin-block-start: 10px;
}

.meeting-rich-text {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 0.9375rem;
  line-height: 1.8;
}

.meeting-rich-text :deep(p) { margin-block: 0 12px; }
.meeting-rich-text :deep(p:last-child) { margin-block-end: 0; }
.meeting-rich-text :deep(ul),
.meeting-rich-text :deep(ol) { margin-block: 0 12px; padding-inline-start: 1.5rem; }
.meeting-rich-text :deep(ul) { list-style-type: disc; }
.meeting-rich-text :deep(ol) { list-style-type: decimal; }
.meeting-rich-text :deep(h1) { font-size: 1.25rem; font-weight: 700; line-height: 1.5; }
.meeting-rich-text :deep(h2) { font-size: 1.125rem; font-weight: 700; line-height: 1.5; }
.meeting-rich-text :deep(h3) { font-size: 1rem; font-weight: 600; line-height: 1.5; }
.meeting-rich-text :deep(a) { overflow-wrap: anywhere; color: var(--brand-link); text-decoration: underline; }
.meeting-rich-text :deep(img) { max-width: 100%; height: auto; }

.meeting-empty {
  color: var(--muted-foreground);
  font-size: 0.875rem;
}

.meeting-attachment-list,
.meeting-resolution-list {
  display: grid;
  min-width: 0;
  gap: 10px;
}

.meeting-attachment-row {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-block: 8px;
  border-block-end: 1px solid var(--border);
}

.meeting-attachment-row:last-child,
.meeting-previous-row:last-child { border-block-end: 0; }

.meeting-upload {
  display: grid;
  min-width: 0;
  gap: 8px;
  margin-block-start: 16px;
  padding-block-start: 16px;
  border-block-start: 1px solid var(--border);
}

.meeting-inline-error,
.meeting-inline-confirm {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-block-start: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.meeting-resolution-card {
  display: grid;
  min-width: 0;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.meeting-resolution-head { min-width: 0; }
.meeting-resolution-title { min-width: 0; overflow-wrap: anywhere; font-size: 0.9375rem; font-weight: 600; }
.meeting-resolution-badges { display: flex; min-width: 0; flex-wrap: wrap; gap: 6px; margin-block-start: 6px; }
.meeting-resolution-meta { display: grid; min-width: 0; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0 12px; padding: 7px 10px; border-radius: 6px; background: var(--muted); }
.meeting-resolution-meta > div { padding-block: 2px; border-block-end: 0; }
.meeting-resolution-result { padding-block-start: 2px; }
.meeting-resolution-actions { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 8px; }

.meeting-conversion {
  min-width: 0;
  border-block-start: 1px solid var(--border);
  padding-block-start: 10px;
}

.meeting-conversion summary {
  width: fit-content;
  max-width: 100%;
  cursor: pointer;
  color: var(--brand-link);
  font-size: 0.875rem;
  font-weight: 500;
}

.meeting-conversion-body {
  display: grid;
  min-width: 0;
  gap: 8px;
  margin-block-start: 10px;
}

.meeting-project-select { flex: 1 1 220px; }
.meeting-previous-row { display: grid; min-width: 0; gap: 8px; padding-block: 10px; border-block-end: 1px solid var(--border); }

@container meeting-summary (min-width: 360px) {
  .meeting-meta-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@container meeting-summary (min-width: 900px) {
  .meeting-meta-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@container meeting-summary (min-width: 720px) {
  .meeting-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 520px) {
  .meeting-project-select { flex-basis: 100%; }
}
</style>
