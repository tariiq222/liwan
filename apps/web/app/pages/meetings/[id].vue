<script setup lang="ts">
import { Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
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
import { useProjects } from '@/composables/useProjects'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
import { formatLocalDateTime } from '@/utils/meetingDateTime'
import { STATUS_CHIP_CLASS } from '@/utils/statusTone'
import { filterMeetingResolutions, resolutionActions } from '@/utils/meetingWorkspace'

const route = useRoute()
const { t } = useI18n()
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
const pendingMeetingAction = ref<{ action: 'confirm' | 'complete' | 'reopen' | 'cancel'; scope?: 'this' | 'this_and_following' } | null>(null)
const pendingResolutionAction = ref<{ resolutionId: number; action: 'start' | 'complete' | 'cancel' | 'reopen' } | null>(null)
const pendingResolutionIds = ref(new Set<number>())
const resolutionErrors = ref<Record<number, string>>({})
const recommendationSearch = ref('')
const recommendationState = ref('')
const projectSearch = ref<Record<number, string>>({})
const filteredResolutions = computed(() => filterMeetingResolutions(query.data.value?.resolutions ?? [], {
  q: recommendationSearch.value,
  state: recommendationState.value,
}))
const historicalSnapshot = computed(() => query.data.value?.state === 'done' ? query.data.value?.minutes_snapshot ?? null : null)
const doneWithoutSnapshot = computed(() => query.data.value?.state === 'done' && !historicalSnapshot.value)

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

function meetingStateTone(state: 'draft' | 'confirmed' | 'done' | 'cancelled') {
  return state === 'done' ? STATUS_CHIP_CLASS.success
    : state === 'cancelled' ? STATUS_CHIP_CLASS.destructive
      : state === 'confirmed' ? STATUS_CHIP_CLASS.info
        : STATUS_CHIP_CLASS.neutral
}

function resolutionStateTone(state: 'open' | 'in_progress' | 'done' | 'cancelled') {
  return state === 'done' ? STATUS_CHIP_CLASS.success
    : state === 'cancelled' ? STATUS_CHIP_CLASS.destructive
      : state === 'in_progress' ? STATUS_CHIP_CLASS.warning
        : STATUS_CHIP_CLASS.info
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
    toast.error(error instanceof ApiError || error instanceof Error ? error.message : t('errors.generic'))
  } finally {
    input.value = ''
  }
}

async function confirmDelete(attachmentId: number) {
  if (!id.value) return
  try {
    await remove({ meetingId: id.value, attachmentId })
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
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
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
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
          <Badge v-if="query.data.value" variant="outline" :class="meetingStateTone(query.data.value.state)">
            {{ t('meetingsUi.state.' + query.data.value.state) }}
          </Badge>
          <span v-if="query.data.value?.reference" class="meeting-reference" dir="ltr">{{ query.data.value.reference }}</span>
        </span>
      </template>
      <template #actions>
        <Button as-child type="button" variant="outline">
          <a :href="`/api/v1/meetings/${id}/minutes.pdf`">{{ t('meetingsUi.pdf') }}</a>
        </Button>
        <Button v-if="query.data.value?.can_edit && pendingResolutionIds.size === 0" as-child type="button" variant="outline">
          <NuxtLink :to="{ path: `/meetings/${id}/edit`, query: returnToQuery(route.fullPath) }">{{ t('app.edit') }}</NuxtLink>
        </Button>
        <Button v-if="query.data.value?.can_edit && query.data.value.state === 'draft'" :disabled="!hydrated || transitioning" @click="requestMeetingAction('confirm')">
          {{ t('meetingsUi.confirm') }}
        </Button>
        <Button v-if="query.data.value?.can_manage && query.data.value.state === 'confirmed'" :disabled="!hydrated || transitioning" @click="requestMeetingAction('complete')">
          {{ t('meetingsUi.complete') }}
        </Button>
        <Button v-if="query.data.value?.can_manage && query.data.value.state !== 'cancelled' && query.data.value.state !== 'done'" variant="outline" :disabled="!hydrated || transitioning" @click="requestMeetingAction('cancel')">
          {{ t('meetingsUi.cancelMeeting') }}
        </Button>
        <Button v-if="query.data.value?.can_manage && (query.data.value.state === 'done' || query.data.value.state === 'cancelled')" variant="outline" :disabled="!hydrated || transitioning" @click="requestMeetingAction('reopen')">
          {{ t('meetingsUi.reopen') }}
        </Button>
      </template>
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <div v-if="query.data.value" class="meeting-detail-stack">
        <section v-if="pendingMeetingAction" class="nasq-panel nasq-panel-body grid gap-3 border-destructive" role="alert">
          <p>{{ t('meetingsUx.confirmMeetingAction', { name: query.data.value.name, scope: pendingMeetingAction.scope === 'this_and_following' ? t('meetingsUi.scopeFollowing') : t('meetingsUi.scopeThis') }) }}</p>
          <select v-if="pendingMeetingAction.action === 'cancel' && query.data.value.series_id" v-model="pendingMeetingAction.scope" class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :disabled="transitioning">
            <option value="this">{{ t('meetingsUi.scopeThis') }}</option>
            <option value="this_and_following">{{ t('meetingsUi.scopeFollowing') }}</option>
          </select>
          <div class="flex gap-2">
            <Button type="button" variant="outline" @click="pendingMeetingAction = null">{{ t('app.cancel') }}</Button>
            <Button type="button" variant="destructive" :disabled="!hydrated || transitioning" @click="confirmMeetingAction">{{ t('meetingsUi.confirm') }}</Button>
          </div>
        </section>
        <nav class="flex min-w-0 flex-wrap gap-2 text-sm" :aria-label="t('meetingsUx.sections')">
          <a href="#meeting-summary" class="text-brand-link underline">{{ t('meetingsUi.summary') }}</a>
          <a v-if="!historicalSnapshot" href="#meeting-agenda" class="text-brand-link underline">{{ t('meetingsUi.agenda') }}</a>
          <a v-if="!historicalSnapshot" href="#meeting-minutes" class="text-brand-link underline">{{ t('meetingsUi.minutes') }}</a>
          <a href="#meeting-resolutions" class="text-brand-link underline">{{ t('meetingsUi.resolutions') }} ({{ query.data.value.resolutions.length }})</a>
          <a href="#meeting-attachments" class="text-brand-link underline">{{ t('meetingsUi.attachmentsTitle') }} ({{ attachments.data.value?.items.length ?? 0 }})</a>
          <a v-if="query.data.value.state === 'done'" href="#meeting-snapshot" class="text-brand-link underline">{{ t('meetingsUx.historicalMinutesTitle') }}</a>
          <a v-if="query.data.value.previous_resolutions.length" href="#meeting-follow-up" class="text-brand-link underline">{{ t('meetingsUx.currentPreviousFollowUp') }}</a>
        </nav>
        <section id="meeting-summary" class="nasq-panel meeting-summary">
          <div class="nasq-panel-header"><h2>{{ t('meetingsUi.summary') }}</h2></div>
          <div class="nasq-panel-body">
            <div class="meeting-summary-grid">
              <section class="meeting-summary-group">
                <h3 class="meeting-subheading">{{ t('meetingsUi.sectionSchedule') }}</h3>
                <dl class="meeting-meta-grid">
                  <div class="meeting-meta-item"><dt>{{ t('meetingsUi.date') }}</dt><dd>{{ displayValue(query.data.value.meeting_date) }}</dd></div>
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
                    <li v-for="person in query.data.value.attendees" :key="person.id" class="min-w-0 max-w-full"><Badge variant="secondary" class="max-w-full whitespace-normal break-words text-start">{{ person.name }}</Badge></li>
                  </ul>
                  <p v-else class="meeting-empty">{{ t('meetingsUi.emptyAttendees') }}</p>
                </div>
              </section>
            </div>
          </div>
        </section>
        <section v-if="query.data.value.state === 'done'" id="meeting-snapshot" class="nasq-panel meeting-section">
          <div class="nasq-panel-header">
            <h2>{{ t('meetingsUx.historicalMinutesTitle') }}</h2>
            <span v-if="historicalSnapshot" class="text-xs text-muted-foreground">{{ t('meetingsUx.capturedAt', { captured_at: historicalSnapshot.captured_at }) }}</span>
          </div>
          <div class="nasq-panel-body grid gap-4">
            <template v-if="historicalSnapshot">
              <div>
                <h3 class="meeting-subheading">{{ t('meetingsUi.agenda') }}</h3>
                <div v-if="hasRichText(historicalSnapshot.agenda)" class="meeting-rich-text" v-html="historicalSnapshot.agenda" />
                <p v-else class="meeting-empty">{{ t('meetingsUi.emptyAgenda') }}</p>
              </div>
              <div>
                <h3 class="meeting-subheading">{{ t('meetingsUi.minutes') }}</h3>
                <div v-if="hasRichText(historicalSnapshot.minutes)" class="meeting-rich-text" v-html="historicalSnapshot.minutes" />
                <p v-else class="meeting-empty">{{ t('meetingsUi.emptyMinutes') }}</p>
              </div>
              <div v-if="historicalSnapshot.resolutions.length" class="grid gap-2">
                <h3 class="meeting-subheading">{{ t('meetingsUx.historicalDecisionStates') }}</h3>
                <div v-for="item in historicalSnapshot.resolutions" :key="item.id" class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <span class="font-medium">{{ item.name }}</span>
                  <span v-if="item.meeting_name" class="text-xs text-muted-foreground">{{ t('meetingsUx.snapshotOrigin', { name: item.meeting_name }) }}</span>
                  <Badge variant="outline">{{ t(`meetingsUi.resolutionState.${item.state}`) }}</Badge>
                  <span v-if="item.result && hasRichText(item.result)" class="meeting-rich-text" v-html="item.result" />
                </div>
              </div>
            </template>
            <p v-else class="text-sm text-muted-foreground">{{ t('meetingsUx.historyUnavailable') }}</p>
          </div>
        </section>
        <div v-if="!historicalSnapshot" class="meeting-content-grid">
          <section id="meeting-agenda" class="nasq-panel meeting-rich-panel">
            <div class="nasq-panel-header"><h2>{{ t('meetingsUi.agenda') }}</h2></div>
            <div class="nasq-panel-body">
              <p v-if="doneWithoutSnapshot" class="mb-3 text-xs text-muted-foreground">{{ t('meetingsUx.currentContentAfterMissingHistory') }}</p>
              <div v-if="hasRichText(query.data.value.agenda)" class="meeting-rich-text" v-html="query.data.value.agenda" />
              <p v-else class="meeting-empty">{{ t('meetingsUi.emptyAgenda') }}</p>
            </div>
          </section>
          <section id="meeting-minutes" class="nasq-panel meeting-rich-panel">
            <div class="nasq-panel-header">
              <h2>{{ t('meetingsUi.minutes') }}</h2>
              <Button v-if="query.data.value.can_edit && pendingResolutionIds.size === 0" as-child size="sm"><NuxtLink :to="{ path: `/meetings/${id}/minutes`, query: returnToQuery(route.fullPath) }">{{ t('meetingsUx.editMinutes') }}</NuxtLink></Button>
            </div>
            <div class="nasq-panel-body">
              <p v-if="doneWithoutSnapshot" class="mb-3 text-xs text-muted-foreground">{{ t('meetingsUx.currentContentAfterMissingHistory') }}</p>
              <div v-if="hasRichText(query.data.value.minutes)" class="meeting-rich-text" v-html="query.data.value.minutes" />
              <p v-else class="meeting-empty">{{ t('meetingsUi.emptyMinutes') }}</p>
            </div>
          </section>
        </div>
        <section id="meeting-resolutions" class="nasq-panel meeting-section">
          <div class="nasq-panel-header">
            <div class="flex min-w-0 flex-wrap items-center gap-2"><h2>{{ t('meetingsUi.resolutions') }}</h2><Badge variant="secondary">{{ query.data.value.resolutions.length }}</Badge><span class="text-xs text-muted-foreground">{{ t('meetingsUx.currentFollowUp') }}</span></div>
            <Button v-if="query.data.value.can_edit" as-child size="sm">
              <NuxtLink :to="{ path: `/meetings/${id}/resolutions/new`, query: returnToQuery(route.fullPath) }">{{ t('meetingsUi.newResolution') }}</NuxtLink>
            </Button>
          </div>
          <div class="nasq-panel-body">
            <div v-if="query.data.value.resolutions.length" class="mb-4 flex min-w-0 flex-wrap gap-2">
              <Input v-model="recommendationSearch" class="min-w-48 flex-1" :placeholder="t('meetingsUx.searchRecommendations')" :aria-label="t('meetingsUx.searchRecommendations')" />
              <select v-model="recommendationState" class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :aria-label="t('meetingsUi.stateLabel')">
                <option value="">{{ t('meetingsUi.allStates') }}</option>
                <option v-for="state in ['open', 'in_progress', 'done', 'cancelled']" :key="state" :value="state">{{ t(`meetingsUi.resolutionState.${state}`) }}</option>
              </select>
            </div>
            <p v-if="conversionError" role="alert" class="text-sm text-destructive">{{ conversionError }}</p>
            <p v-if="!query.data.value.resolutions.length" class="meeting-empty">{{ t('meetingsUi.emptyResolutions') }}</p>
            <p v-else-if="!filteredResolutions.length" class="meeting-empty">{{ t('meetingsUx.noMatchingRecommendations') }}</p>
            <ul v-else class="meeting-resolution-list">
            <li v-for="item in filteredResolutions" :key="item.id" class="meeting-resolution-card">
              <div class="meeting-resolution-head">
                <h3 class="meeting-resolution-title">{{ item.name }}</h3>
                <div class="meeting-resolution-badges">
                  <Badge variant="outline" :class="resolutionStateTone(resolutionProjection(item))">{{ t(`meetingsUi.resolutionState.${resolutionProjection(item)}`) }}</Badge>
                  <Badge v-if="resolutionProjection(item) !== item.state" variant="outline">{{ t('meetingsUx.decisionState', { state: t(`meetingsUi.resolutionState.${item.state}`) }) }}</Badge>
                  <Badge variant="secondary">{{ t(`meetingsUx.priorityLabel.${item.priority}`) }}</Badge>
                </div>
              </div>
              <dl class="meeting-resolution-meta">
                <div><dt>{{ t('meetingsUi.responsible') }}</dt><dd>{{ displayValue(item.responsible?.name) }}</dd></div>
                <div><dt>{{ t('meetingsUi.deadline') }}</dt><dd>{{ displayValue(item.deadline) }}</dd></div>
              </dl>
              <div v-if="hasRichText(item.result)" class="meeting-rich-text meeting-resolution-result" v-html="item.result" />
              <div class="meeting-resolution-actions">
                <template v-if="!taskLinked(item)">
                <Button v-if="actionsFor(item).includes('start')" size="sm" variant="outline" :disabled="!hydrated || pendingResolutionAction?.resolutionId === item.id || pendingResolutionIds.has(item.id)" @click="requestResolutionAction(item.id, 'start')">{{ t('meetingsUi.startWork') }}</Button>
                <Button v-if="actionsFor(item).includes('complete')" size="sm" :disabled="!hydrated || pendingResolutionAction?.resolutionId === item.id || pendingResolutionIds.has(item.id)" @click="requestResolutionAction(item.id, 'complete')">{{ t('meetingsUi.complete') }}</Button>
                <Button v-if="actionsFor(item).includes('cancel')" size="sm" variant="outline" :disabled="!hydrated || pendingResolutionAction?.resolutionId === item.id || pendingResolutionIds.has(item.id)" @click="requestResolutionAction(item.id, 'cancel')">{{ t('meetingsUi.cancelMeeting') }}</Button>
                </template>
                <Button v-if="item.task_id" as-child variant="link" size="sm" class="h-auto p-0"><NuxtLink :to="`/tasks/${item.task_id}`">{{ t('meetingsUi.openTask') }}</NuxtLink></Button>
                <span v-else-if="taskLinked(item)" class="text-xs text-muted-foreground">{{ t('meetingsUx.taskLinkedUnavailable') }}</span>
                <Button v-if="!taskLinked(item) && (item.can_edit_decision || item.can_update_execution) && !pendingResolutionIds.has(item.id)" as-child variant="outline" size="sm">
                  <NuxtLink :to="{ path: `/meetings/${id}/resolutions/${item.id}/edit`, query: returnToQuery(route.fullPath) }">{{ t('meetingsUi.editResolution') }}</NuxtLink>
                </Button>
                <Button v-if="resolutionCanReopen(item)" size="sm" variant="outline" :disabled="!hydrated || pendingResolutionIds.has(item.id)" @click="requestResolutionAction(item.id, 'reopen')">{{ t('meetingsUi.reopen') }}</Button>
              </div>
              <p v-if="resolutionErrors[item.id]" role="alert" class="text-sm text-destructive">{{ resolutionErrors[item.id] }}</p>
              <div v-if="pendingResolutionAction?.resolutionId === item.id" class="meeting-inline-confirm" role="alert">
                  <span class="text-sm">{{ t('meetingsUx.confirmResolutionAction', { name: pendingResolutionName }) }}</span>
                <div class="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" :disabled="pendingResolutionAction ? pendingResolutionIds.has(pendingResolutionAction.resolutionId) : false" @click="pendingResolutionAction = null">{{ t('app.cancel') }}</Button>
                  <Button type="button" variant="destructive" size="sm" :disabled="!hydrated || (pendingResolutionAction ? pendingResolutionIds.has(pendingResolutionAction.resolutionId) : false)" @click="confirmResolutionAction">{{ t('meetingsUi.confirm') }}</Button>
                </div>
              </div>
              <p v-if="item.task_id" class="text-xs text-muted-foreground">{{ t('meetingsUi.followedAsTask') }}</p>
              <details v-if="!taskLinked(item) && !resolutionCanReopen(item) && canConvert && item.can_edit_decision" class="meeting-conversion">
                <summary>{{ t('meetingsUi.conversionTitle') }}</summary>
                <div class="meeting-conversion-body">
                  <label :for="`meeting-project-${item.id}`" class="text-sm font-medium">{{ t('meetingsUi.chooseProject') }}</label>
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <Input v-model="projectSearch[item.id]" class="meeting-project-select" :placeholder="t('meetingsUx.searchProjects')" :aria-label="t('meetingsUx.searchProjects')" :disabled="!hydrated || converting || pendingResolutionIds.has(item.id)" />
                    <select :id="`meeting-project-${item.id}`" :value="projectByResolution[item.id] || ''" class="meeting-project-select border-input h-9 w-full min-w-0 max-w-full rounded-lg border bg-background px-2 text-sm" :disabled="!hydrated || converting || pendingResolutionIds.has(item.id)" @change="projectByResolution[item.id] = Number(($event.target as HTMLSelectElement).value)">
                      <option value="">{{ t('meetingsUi.project') }}</option>
                      <option v-for="project in projectsFor(item.id)" :key="project.id" :value="project.id">{{ project.name }}</option>
                    </select>
                    <Button size="sm" :disabled="!hydrated || converting || pendingResolutionIds.has(item.id) || !projectByResolution[item.id]" @click="convertResolution(item.id)">{{ t('meetingsUi.convert') }}</Button>
                  </div>
                  <p v-if="projectQuery.isLoading.value" class="text-xs text-muted-foreground">{{ t('meetingsUx.projectsLoading') }}</p>
                  <p v-else-if="projectQuery.error.value" class="text-xs text-destructive">{{ t('meetingsUx.projectsError') }}</p>
                  <p class="text-xs text-muted-foreground">{{ t('meetingsUi.conversionHelp') }}</p>
                </div>
              </details>
            </li>
            </ul>
          </div>
        </section>
        <section id="meeting-attachments" class="nasq-panel meeting-section">
          <div class="nasq-panel-header">
            <h2>{{ t('meetingsUi.attachmentsTitle') }}</h2>
          </div>
          <div class="nasq-panel-body">
          <div v-if="attachments.error.value" class="meeting-inline-error" role="alert">
            <p class="text-sm text-destructive">{{ errorMessage(attachments.error.value) }}</p>
            <Button type="button" variant="outline" size="sm" :disabled="!hydrated || attachments.isFetching.value" @click="attachments.refetch">{{ t('app.retry') }}</Button>
          </div>
          <p v-else-if="attachments.isLoading.value" class="meeting-empty">{{ t('attachments.loading') }}</p>
          <ul v-else-if="attachments.data.value?.items.length" class="meeting-attachment-list">
            <li v-for="attachment in attachments.data.value.items" :key="attachment.id" class="meeting-attachment-row">
              <a :href="attachment.url" class="min-w-0 flex-1 truncate text-brand-link underline" target="_blank" rel="noopener">{{ attachment.name }}</a>
              <Button v-if="query.data.value.can_edit && pendingDeleteId !== attachment.id" type="button" variant="ghost" size="icon" class="size-[32px] shrink-0 rounded-lg" :aria-label="t('attachments.delete')" :disabled="!hydrated || deleting || pendingDeleteId !== null" @click="pendingDeleteId = attachment.id">
                <Trash2 class="size-[18px]" />
              </Button>
              <div v-if="pendingDeleteId === attachment.id" class="meeting-inline-confirm" role="group" :aria-label="t('attachments.deleteConfirm')">
                <span class="text-sm text-muted-foreground">{{ t('attachments.deleteConfirm') }}</span>
                <div class="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" :disabled="!hydrated || deleting" @click="pendingDeleteId = null">{{ t('attachments.cancel') }}</Button>
                  <Button type="button" variant="destructive" size="sm" :disabled="!hydrated || deleting" @click="confirmDelete(attachment.id)">{{ t('attachments.confirm') }}</Button>
                </div>
              </div>
            </li>
          </ul>
          <p v-else class="meeting-empty">{{ t('meetingsUi.emptyAttachments') }}</p>
          <div v-if="query.data.value.can_edit" class="meeting-upload">
            <Label for="meeting-attachment-upload">{{ t('meetingsUi.uploadAttachment') }}</Label>
            <input id="meeting-attachment-upload" class="border-input h-10 w-full min-w-0 max-w-full rounded-lg border bg-transparent px-3 py-1 text-sm shadow-xs file:me-2 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium" type="file" :disabled="!hydrated || uploading" @change="onFileChange">
            <p class="text-xs text-muted-foreground">{{ t('meetingsUi.attachmentHelp') }}</p>
          </div>
          </div>
        </section>
        <section v-if="query.data.value.previous_resolutions.length" id="meeting-follow-up" class="nasq-panel">
          <div class="nasq-panel-header"><h2>{{ t('meetingsUi.previousResolutions') }}</h2><span class="text-xs text-muted-foreground">{{ t('meetingsUx.currentPreviousFollowUp') }}</span></div>
          <div class="nasq-panel-body grid gap-3">
          <div v-for="item in query.data.value.previous_resolutions" :key="item.id" class="meeting-previous-row">
            <NuxtLink :to="{ path: `/meetings/${item.meeting_id}`, query: returnToQuery(route.fullPath) }" class="font-medium text-brand-link">{{ item.meeting_name }}</NuxtLink>
            <div class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <span>{{ item.name }}</span>
              <span class="text-xs text-muted-foreground">{{ t('meetingsUx.currentFollowUpOrigin', { name: item.meeting_name }) }}</span>
              <Badge variant="outline" :class="resolutionStateTone(item.state)">{{ t(`meetingsUi.resolutionState.${item.state}`) }}</Badge>
              <span>{{ displayValue(item.deadline) }}</span>
            </div>
            <div v-if="hasRichText(item.result)" class="meeting-rich-text" v-html="item.result" />
            <Button v-if="item.task_id" as-child variant="link" size="sm" class="h-auto w-fit p-0"><NuxtLink :to="`/tasks/${item.task_id}`">{{ t('meetingsUi.openTask') }}</NuxtLink></Button>
          </div>
          </div>
        </section>
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

.meeting-content-grid {
  display: grid;
  min-width: 0;
  gap: 16px;
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

@container meeting-detail (min-width: 900px) {
  .meeting-content-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 520px) {
  .meeting-project-select { flex-basis: 100%; }
}
</style>
