<script setup lang="ts">
import { Paperclip, Trash2 } from '@lucide/vue'
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

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const isDetail = computed(() => route.path === `/meetings/${id.value}`)
const query = useMeeting(computed(() => isDetail.value ? id.value : null))
const attachments = useMeetingAttachments(computed(() => isDetail.value ? id.value : null))
const { can } = useAccess()
const canConvert = computed(() => isDetail.value && !!query.data.value?.can_edit && can('pmo.projects.read') && can('pmo.tasks.create'))
const { data: projects } = useProjects(canConvert)
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

function resolutionCanReopen(resolution: { can_edit_decision: boolean; task_id: number | null; state: 'open' | 'in_progress' | 'done' | 'cancelled' }) {
  return resolution.can_edit_decision && !resolution.task_id && (resolution.state === 'done' || resolution.state === 'cancelled')
}

function localTime(value: string | null) {
  return formatLocalDateTime(value)
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
  if (!hydrated.value || !canConvert.value || !projectId || !id.value) return
  conversionError.value = ''
  try {
    const task = await convert({ meetingId: id.value, resolutionId, projectId })
    await navigateTo(`/tasks/${task.id}`)
  } catch (error) {
    conversionError.value = error instanceof ApiError ? error.message : t('meetingsUi.convertError')
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
  if (!hydrated.value || !resolution || resolution.task_id) return
  if (action === 'reopen' ? !resolutionCanReopen(resolution) : !resolution.can_update_execution) return
  if (action === 'cancel') pendingResolutionAction.value = { resolutionId, action }
  else void executeResolutionAction({ resolutionId, action })
}

async function executeResolutionAction(pending: { resolutionId: number; action: 'start' | 'complete' | 'cancel' | 'reopen' }) {
  if (!hydrated.value || !id.value) return
  try {
    await runResolution({ meetingId: id.value, resolutionId: pending.resolutionId, action: pending.action })
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  } finally {
    if (pendingResolutionAction.value?.resolutionId === pending.resolutionId) pendingResolutionAction.value = null
  }
}

async function confirmResolutionAction() {
  const pending = pendingResolutionAction.value
  if (!pending) return
  await executeResolutionAction(pending)
}
</script>

<template>
  <SharedPageContainer v-if="isDetail" width="detail">
    <SharedPageHeader :title="query.data.value?.name || t('nav.meetings')" :back-to="backTo">
      <template #actions>
        <a :href="`/api/v1/meetings/${id}/minutes.pdf`" class="inline-flex">
          <Button type="button" variant="outline">{{ t('meetingsUi.pdf') }}</Button>
        </a>
        <NuxtLink v-if="query.data.value?.can_edit" :to="{ path: `/meetings/${id}/edit`, query: returnToQuery(route.fullPath) }">
          <Button>{{ t('app.edit') }}</Button>
        </NuxtLink>
        <Button v-if="query.data.value?.can_edit && query.data.value.state === 'draft'" :disabled="!hydrated || transitioning" @click="requestMeetingAction('confirm')">{{ t('meetingsUi.confirm') }}</Button>
        <Button v-if="query.data.value?.can_manage && query.data.value.state === 'confirmed'" :disabled="!hydrated || transitioning" @click="requestMeetingAction('complete')">{{ t('meetingsUi.complete') }}</Button>
        <Button v-if="query.data.value?.can_manage && query.data.value.state !== 'cancelled' && query.data.value.state !== 'done'" variant="outline" :disabled="!hydrated || transitioning" @click="requestMeetingAction('cancel')">{{ t('meetingsUi.cancelMeeting') }}</Button>
        <Button v-if="query.data.value?.can_manage && (query.data.value.state === 'done' || query.data.value.state === 'cancelled')" variant="outline" :disabled="!hydrated || transitioning" @click="requestMeetingAction('reopen')">{{ t('meetingsUi.reopen') }}</Button>
      </template>
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <div v-if="query.data.value" class="grid gap-4">
        <section v-if="pendingMeetingAction" class="nasq-panel nasq-panel-body grid gap-3 border-destructive" role="alert">
          <p>{{ t('meetingsUi.confirmAction') }}</p>
          <select v-if="pendingMeetingAction.action === 'cancel' && query.data.value.series_id" v-model="pendingMeetingAction.scope" class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :disabled="transitioning">
            <option value="this">{{ t('meetingsUi.scopeThis') }}</option>
            <option value="this_and_following">{{ t('meetingsUi.scopeFollowing') }}</option>
          </select>
          <div class="flex gap-2">
            <Button type="button" variant="outline" @click="pendingMeetingAction = null">{{ t('app.cancel') }}</Button>
            <Button type="button" variant="destructive" :disabled="!hydrated || transitioning" @click="confirmMeetingAction">{{ t('meetingsUi.confirm') }}</Button>
          </div>
        </section>
        <section class="nasq-panel nasq-panel-body">
          <dl class="nasq-metadata">
            <div><dt>{{ t('meetingsUi.state.' + query.data.value.state) }}</dt><dd>{{ query.data.value.reference }}</dd></div>
            <div><dt>{{ t('meetingsUi.date') }}</dt><dd>{{ query.data.value.meeting_date }}</dd></div>
            <div><dt>{{ t('meetingsUi.start') }}</dt><dd>{{ hydrated ? localTime(query.data.value.start_datetime) : '—' }}</dd></div>
            <div><dt>{{ t('meetingsUi.end') }}</dt><dd>{{ hydrated ? localTime(query.data.value.end_datetime) : '—' }}</dd></div>
            <div><dt>{{ t('meetingsUi.organizer') }}</dt><dd>{{ query.data.value.organizer?.name }}</dd></div>
            <div><dt>{{ t('meetingsUi.secretary') }}</dt><dd>{{ query.data.value.secretary?.name || '—' }}</dd></div>
            <div v-if="query.data.value.series"><dt>{{ t('meetingsUi.series') }}</dt><dd><NuxtLink :to="`/meetings/series/${query.data.value.series.id}`" class="text-brand-link">{{ query.data.value.series.name }}</NuxtLink></dd></div>
            <div><dt>{{ t('meetingsUi.location') }}</dt><dd>{{ query.data.value.location || '—' }}</dd></div>
            <div v-if="query.data.value.meeting_url">
              <dt>{{ t('meetingsUi.url') }}</dt>
              <dd><a :href="query.data.value.meeting_url" target="_blank" rel="noopener" class="text-brand-link underline" dir="ltr">{{ query.data.value.meeting_url }}</a></dd>
            </div>
          </dl>
          <p class="mt-3 text-sm">{{ t('meetingsUi.attendees') }}: {{ query.data.value.attendees.map(person => person.name).join('، ') || '—' }}</p>
        </section>
        <section class="nasq-panel nasq-panel-body">
          <h2 class="mb-2 text-sm font-semibold">{{ t('meetingsUi.agenda') }}</h2>
          <div class="prose prose-sm max-w-none" v-html="query.data.value.agenda" />
          <h2 class="mt-4 mb-2 text-sm font-semibold">{{ t('meetingsUi.minutes') }}</h2>
          <div class="prose prose-sm max-w-none" v-html="query.data.value.minutes" />
        </section>
        <section class="nasq-panel nasq-panel-body">
          <div class="mb-3 flex items-center gap-2">
            <Paperclip class="size-[18px] text-muted-foreground" />
            <h2 class="text-sm font-semibold">{{ t('meetingsUi.attachmentsTitle') }}</h2>
          </div>
          <ul>
            <li v-for="attachment in attachments.data.value?.items ?? []" :key="attachment.id" class="flex items-center gap-2 border-b border-border py-2 last:border-0">
              <a :href="attachment.url" class="min-w-0 flex-1 truncate text-brand-link underline" target="_blank" rel="noopener">{{ attachment.name }}</a>
              <Button v-if="query.data.value.can_edit && pendingDeleteId !== attachment.id" type="button" variant="ghost" size="icon" class="size-[32px] rounded-lg" :aria-label="t('attachments.delete')" :disabled="!hydrated || deleting" @click="pendingDeleteId = attachment.id">
                <Trash2 class="size-[18px]" />
              </Button>
              <div v-if="pendingDeleteId === attachment.id" class="flex gap-2">
                <Button type="button" variant="outline" size="sm" @click="pendingDeleteId = null">{{ t('app.cancel') }}</Button>
                <Button type="button" variant="destructive" size="sm" @click="confirmDelete(attachment.id)">{{ t('attachments.confirm') }}</Button>
              </div>
            </li>
          </ul>
          <input v-if="query.data.value.can_edit" class="mt-3 border-input h-9 w-full rounded-lg border px-3 text-sm" type="file" :disabled="!hydrated || uploading" @change="onFileChange">
        </section>
        <section class="nasq-panel nasq-panel-body grid gap-3">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-sm font-semibold">{{ t('meetingsUi.resolutions') }}</h2>
            <NuxtLink v-if="query.data.value.can_edit" :to="{ path: `/meetings/${id}/resolutions/new`, query: returnToQuery(route.fullPath) }">
              <Button size="sm">{{ t('meetingsUi.newResolution') }}</Button>
            </NuxtLink>
          </div>
          <p v-if="conversionError" role="alert" class="text-sm text-destructive">{{ conversionError }}</p>
          <div v-for="item in query.data.value.resolutions" :key="item.id" class="grid gap-2 border-b border-border py-3 last:border-0">
            <p class="font-medium">{{ item.name }}</p>
            <p class="text-sm text-muted-foreground">{{ item.responsible?.name }} · {{ item.deadline }} · {{ t(`meetingsUi.priorityLabel.${item.priority}`) }} · {{ t(`meetingsUi.resolutionState.${item.state}`) }}</p>
            <div v-if="item.result" class="prose prose-sm max-w-none" v-html="item.result" />
            <div v-if="item.can_update_execution && !item.task_id" class="flex flex-wrap gap-2">
              <Button v-if="item.state === 'open'" size="sm" variant="outline" :disabled="!hydrated" @click="requestResolutionAction(item.id, 'start')">{{ t('meetingsUi.startWork') }}</Button>
              <Button v-if="item.state === 'open' || item.state === 'in_progress'" size="sm" :disabled="!hydrated" @click="requestResolutionAction(item.id, 'complete')">{{ t('meetingsUi.complete') }}</Button>
              <Button v-if="item.state !== 'cancelled' && item.state !== 'done'" size="sm" variant="outline" :disabled="!hydrated" @click="requestResolutionAction(item.id, 'cancel')">{{ t('meetingsUi.cancelMeeting') }}</Button>
            </div>
            <div v-if="pendingResolutionAction?.resolutionId === item.id" class="flex items-center gap-2" role="alert">
              <span class="text-sm">{{ t('meetingsUi.confirmAction') }}</span>
              <Button type="button" variant="outline" size="sm" @click="pendingResolutionAction = null">{{ t('app.cancel') }}</Button>
              <Button type="button" variant="destructive" size="sm" :disabled="!hydrated" @click="confirmResolutionAction">{{ t('meetingsUi.confirm') }}</Button>
            </div>
            <p v-if="item.task_id" class="text-xs text-muted-foreground">{{ t('meetingsUi.followedAsTask') }}</p>
            <NuxtLink v-if="item.task_id" :to="`/tasks/${item.task_id}`" class="text-sm text-brand-link">{{ t('meetingsUi.openTask') }}</NuxtLink>
            <NuxtLink v-if="!item.task_id && (item.can_edit_decision || item.can_update_execution)" :to="{ path: `/meetings/${id}/resolutions/${item.id}/edit`, query: returnToQuery(route.fullPath) }">
              <Button size="sm" variant="outline">{{ t('meetingsUi.editResolution') }}</Button>
            </NuxtLink>
            <Button v-if="resolutionCanReopen(item)" size="sm" variant="outline" :disabled="!hydrated" @click="requestResolutionAction(item.id, 'reopen')">{{ t('meetingsUi.reopen') }}</Button>
            <div v-else-if="canConvert && item.can_edit_decision" class="flex flex-wrap items-center gap-2">
              <select class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || converting" @change="projectByResolution[item.id] = Number(($event.target as HTMLSelectElement).value)">
                <option value="">{{ t('meetingsUi.project') }}</option>
                <option v-for="project in projects ?? []" :key="project.id" :value="project.id">{{ project.name }}</option>
              </select>
              <Button size="sm" :disabled="!hydrated || converting || !projectByResolution[item.id]" @click="convertResolution(item.id)">{{ t('meetingsUi.convert') }}</Button>
            </div>
          </div>
        </section>
        <section v-if="query.data.value.previous_resolutions.length" class="nasq-panel nasq-panel-body grid gap-3">
          <h2 class="text-sm font-semibold">{{ t('meetingsUi.previousResolutions') }}</h2>
          <div v-for="item in query.data.value.previous_resolutions" :key="item.id" class="border-b border-border py-2 last:border-0">
            <NuxtLink :to="{ path: `/meetings/${item.meeting_id}`, query: returnToQuery(route.fullPath) }" class="font-medium text-brand-link">{{ item.meeting_name }}</NuxtLink>
            <p class="text-sm">{{ item.name }} · {{ t(`meetingsUi.resolutionState.${item.state}`) }} · {{ item.deadline }}</p>
            <div v-if="item.result" class="prose prose-sm max-w-none" v-html="item.result" />
            <NuxtLink v-if="item.task_id" :to="`/tasks/${item.task_id}`" class="text-sm text-brand-link">{{ t('meetingsUi.openTask') }}</NuxtLink>
          </div>
        </section>
      </div>
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage v-else />
</template>
