<script setup lang="ts">
import type { MeetingDetail } from '@webvue/contracts'
import { recordChildTo } from '@/utils/recordListOrigin'
import { MEETING_LIST_PATHS } from '@/modules/meetings/navigation'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import { ApiError } from '@/composables/useApi'
import { useConvertResolution, useResolutionAction } from '@/composables/useMeetings'
import { formatMeetingDate } from '@/utils/meetingMinutesForm'
import { resolutionStateBadgeProps } from '@/utils/meetingStatus'
import { richTextHasContent } from '@/utils/richText'
import { filterMeetingResolutions, resolutionActions } from '@/utils/meetingWorkspace'

type Resolution = MeetingDetail['resolutions'][number]
type ResolutionAction = 'start' | 'complete' | 'cancel' | 'reopen'

const props = defineProps<{ meeting: MeetingDetail; meetingId: number }>()
// True while a resolution action or conversion is in flight; the page hides its edit buttons meanwhile.
const emit = defineEmits<{ 'update:busy': [busy: boolean] }>()

const route = useRoute()
const sourcePaths = useRecordListPaths(MEETING_LIST_PATHS)
const { t, locale } = useI18n()
const hydrated = useHydrated()
const projectPicker = useRecordPicker('project', { forTasks: true, enabled: () => props.meeting.can_edit })
const canConvert = computed(() => props.meeting.can_edit && projectPicker.available.value)
const projectQuery = projectPicker.query
const { data: projects } = projectQuery
const { mutateAsync: convert, isPending: converting } = useConvertResolution()
const { mutateAsync: runResolution } = useResolutionAction()
const conversionError = ref('')
const convertedResolutions = ref(new Set<number>())
// A successful conversion blocks another submit only until the next server projection.
watch(() => props.meeting.resolutions, () => { convertedResolutions.value = new Set() })
const projectByResolution = ref<Record<number, number>>({})
const projectSearch = ref<Record<number, string>>({})
const pendingResolutionAction = ref<{ resolutionId: number; action: ResolutionAction } | null>(null)
const pendingResolutionIds = ref(new Set<number>())
const resolutionErrors = ref<Record<number, string>>({})
const recommendationSearch = ref('')
const recommendationState = ref('')
const recommendationStateSelect = computed({
  get: () => recommendationState.value || '__all__',
  set: value => { recommendationState.value = value === '__all__' ? '' : String(value) },
})
const filteredResolutions = computed(() => filterMeetingResolutions(props.meeting.resolutions, {
  q: recommendationSearch.value,
  state: recommendationState.value,
}))
const pendingResolutionName = computed(() => {
  const resolutionId = pendingResolutionAction.value?.resolutionId
  return resolutionId ? props.meeting.resolutions.find(item => item.id === resolutionId)?.name || '' : ''
})

watch(() => pendingResolutionIds.value.size > 0, busy => emit('update:busy', busy))

function childTo(path: string, query = route.query) {
  return recordChildTo(path, query, sourcePaths.value, route.hash)
}

function resolutionProjection(resolution: Resolution) {
  return resolution.execution_state || resolution.state
}

function taskLinked(resolution: Resolution) {
  return Boolean(resolution.task_id || resolution.task_linked || convertedResolutions.value.has(resolution.id))
}

function actionsFor(resolution: Resolution) {
  return resolutionActions(resolution)
}

function resolutionCanReopen(resolution: Resolution) {
  return actionsFor(resolution).includes('reopen') && !taskLinked(resolution)
}

function projectsFor(resolutionId: number) {
  const q = projectSearch.value[resolutionId]?.trim().toLocaleLowerCase() ?? ''
  const all = projects.value ?? []
  const filtered = all.filter(project => !q || project.name.toLocaleLowerCase().includes(q))
  const selectedId = projectByResolution.value[resolutionId]
  const selected = selectedId ? all.find(project => project.id === selectedId) : undefined
  return selected && !filtered.some(project => project.id === selected.id) ? [selected, ...filtered] : filtered
}

function setResolutionPending(resolutionId: number, pending: boolean) {
  const next = new Set(pendingResolutionIds.value)
  if (pending) next.add(resolutionId)
  else next.delete(resolutionId)
  pendingResolutionIds.value = next
}

async function convertResolution(resolutionId: number) {
  const projectId = projectByResolution.value[resolutionId]
  if (!hydrated.value || !canConvert.value || !projectId || pendingResolutionIds.value.has(resolutionId) || convertedResolutions.value.has(resolutionId)) return
  if (!(projects.value ?? []).some(project => project.id === projectId)) {
    projectByResolution.value = { ...projectByResolution.value, [resolutionId]: 0 }
    return
  }
  conversionError.value = ''
  setResolutionPending(resolutionId, true)
  try {
    await convert({ meetingId: props.meetingId, resolutionId, projectId })
    const current = props.meeting.resolutions.find(item => item.id === resolutionId)
    if (current && !current.task_linked && !current.task_id) {
      convertedResolutions.value = new Set([...convertedResolutions.value, resolutionId])
    }
  } catch (error) {
    conversionError.value = error instanceof ApiError ? error.message : t('meetingsUi.convertError')
  } finally {
    setResolutionPending(resolutionId, false)
  }
}

function requestResolutionAction(resolutionId: number, action: ResolutionAction) {
  const resolution = props.meeting.resolutions.find(item => item.id === resolutionId)
  if (!hydrated.value || !resolution || taskLinked(resolution) || pendingResolutionIds.value.has(resolutionId) || pendingResolutionAction.value?.resolutionId === resolutionId || !actionsFor(resolution).includes(action)) return
  if (action === 'cancel') pendingResolutionAction.value = { resolutionId, action }
  else void executeResolutionAction({ resolutionId, action })
}

async function executeResolutionAction(pending: { resolutionId: number; action: ResolutionAction }) {
  if (!hydrated.value || pendingResolutionIds.value.has(pending.resolutionId)) return
  setResolutionPending(pending.resolutionId, true)
  try {
    await runResolution({ meetingId: props.meetingId, resolutionId: pending.resolutionId, action: pending.action })
    resolutionErrors.value = { ...resolutionErrors.value, [pending.resolutionId]: '' }
  } catch (error) {
    resolutionErrors.value = { ...resolutionErrors.value, [pending.resolutionId]: error instanceof ApiError ? error.message : t('errors.generic') }
  } finally {
    setResolutionPending(pending.resolutionId, false)
    if (pendingResolutionAction.value?.resolutionId === pending.resolutionId) pendingResolutionAction.value = null
  }
}

async function confirmResolutionAction() {
  const pending = pendingResolutionAction.value
  if (pending) await executeResolutionAction(pending)
}
</script>

<template>
  <SharedRecordSection id="meeting-resolutions" variant="list" :title="t('meetingsUi.resolutions')" :description="t('meetingsUx.currentFollowUp')">
    <template v-if="meeting.can_edit && !['done', 'cancelled'].includes(meeting.state)" #actions>
      <UButton size="sm" icon="i-lucide-plus" :to="childTo(`/meetings/${meetingId}/resolutions/new`, { ...route.query, tab: 'resolutions' })" :label="t('meetingsUi.newResolution')" />
    </template>
    <div v-if="meeting.resolutions.length" class="min-w-0 px-(--webvue-card-pad-dense) py-3">
      <FilterBar embedded class="w-full" :active-count="Number(Boolean(recommendationSearch.trim())) + Number(Boolean(recommendationState))" :disabled="!hydrated" @clear="recommendationSearch = ''; recommendationState = ''">
        <template #search>
          <UInput v-model="recommendationSearch" icon="i-lucide-search" :disabled="!hydrated" class="w-full" :placeholder="t('meetingsUx.searchRecommendations')" :aria-label="t('meetingsUx.searchRecommendations')">
            <template v-if="recommendationSearch" #trailing>
              <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('meetingsFilters.clearSearch')" class="-me-1" @click="recommendationSearch = ''" />
            </template>
          </UInput>
        </template>
        <template #default>
          <USelect class="w-full md:w-44" icon="i-lucide-activity" :disabled="!hydrated" :aria-label="t('meetingsUi.stateLabel')" :model-value="recommendationStateSelect" :items="[{ label: t('meetingsUi.allStates'), value: '__all__' }, ...['open', 'in_progress', 'done', 'cancelled'].map(state => ({ label: t(`meetingsUi.resolutionState.${state}`), value: state }))]" @update:model-value="recommendationStateSelect = String($event)" />
        </template>
      </FilterBar>
    </div>
    <p v-if="conversionError" role="alert" class="px-(--webvue-card-pad) py-3 text-sm text-error">{{ conversionError }}</p>
    <div v-if="!meeting.resolutions.length" class="p-(--webvue-card-pad)"><SharedEmptyState :title="t('meetingsUi.emptyResolutions')" /></div>
    <div v-else-if="!filteredResolutions.length" class="p-(--webvue-card-pad)"><SharedEmptyState :title="t('meetingsUx.noMatchingRecommendations')" /></div>
    <template v-else>
      <article v-for="item in filteredResolutions" :key="item.id" class="grid min-w-0 gap-3 px-(--webvue-card-pad) py-4">
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h3 class="min-w-0 break-words text-base font-semibold text-highlighted">{{ item.name }}</h3>
          <div class="flex min-w-0 flex-wrap gap-1.5">
            <SharedStatusBadge v-bind="resolutionStateBadgeProps(resolutionProjection(item), t)" />
            <SharedStatusBadge v-if="resolutionProjection(item) !== item.state" v-bind="resolutionStateBadgeProps(item.state, t, t('meetingsUx.decisionState', { state: t(`meetingsUi.resolutionState.${item.state}`) }))" variant="outline" />
            <SharedStatusBadge tone="neutral" :label="t(`meetingsUx.priorityLabel.${item.priority}`)" />
          </div>
        </div>
        <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div class="min-w-0"><dt class="text-xs text-muted">{{ t('meetingsUi.responsible') }}</dt><dd class="break-words text-highlighted">{{ item.responsible?.name || '—' }}</dd></div>
          <div class="min-w-0"><dt class="text-xs text-muted">{{ t('meetingsUi.deadline') }}</dt><dd class="text-highlighted">{{ formatMeetingDate(item.deadline, locale) }}</dd></div>
          <div v-if="item.execution_period" class="min-w-0"><dt class="text-xs text-muted">{{ t('meetingMinutesForm.executionPeriod') }}</dt><dd class="break-words text-highlighted">{{ item.execution_period }}</dd></div>
          <div v-if="item.project" class="min-w-0"><dt class="text-xs text-muted">{{ t('meetingMinutesForm.project') }}</dt><dd class="break-words text-highlighted">{{ item.project.name }}</dd></div>
        </dl>
        <SharedRichText v-if="richTextHasContent(item.result)" :html="item.result" size="sm" />
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <template v-if="!taskLinked(item)">
            <UButton v-if="actionsFor(item).includes('start')" size="sm" color="neutral" variant="outline" :disabled="!hydrated || pendingResolutionAction?.resolutionId === item.id || pendingResolutionIds.has(item.id)" :label="t('meetingsUi.startWork')" @click="requestResolutionAction(item.id, 'start')" />
            <UButton v-if="actionsFor(item).includes('complete')" size="sm" :disabled="!hydrated || pendingResolutionAction?.resolutionId === item.id || pendingResolutionIds.has(item.id)" :label="t('meetingsUi.complete')" @click="requestResolutionAction(item.id, 'complete')" />
            <UButton v-if="actionsFor(item).includes('cancel')" size="sm" color="neutral" variant="outline" :disabled="!hydrated || pendingResolutionAction?.resolutionId === item.id || pendingResolutionIds.has(item.id)" :label="t('meetingsUi.cancelMeeting')" @click="requestResolutionAction(item.id, 'cancel')" />
          </template>
          <UButton v-if="item.task_id" color="primary" variant="link" size="sm" class="p-0" :to="`/tasks/${item.task_id}`" target="_blank" rel="noopener" :label="t('meetingsUx.openTaskNewTab')" />
          <span v-else-if="taskLinked(item)" class="text-xs text-muted">{{ t('meetingsUx.taskLinkedUnavailable') }}</span>
          <UButton v-if="!taskLinked(item) && (item.can_edit_decision || item.can_update_execution) && !pendingResolutionIds.has(item.id)" color="neutral" variant="outline" size="sm" :to="childTo(`/meetings/${meetingId}/resolutions/${item.id}/edit`)" :label="t('meetingsUi.editResolution')" />
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
        <SharedSubCard v-if="!taskLinked(item) && !resolutionCanReopen(item) && canConvert && item.can_edit_decision" as="details" tone="tinted">
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
        </SharedSubCard>
      </article>
    </template>
  </SharedRecordSection>
  <SharedRecordSection v-if="meeting.previous_resolutions.length" id="meeting-follow-up" variant="list" :title="t('meetingsUi.previousResolutions')" :description="t('meetingsUx.currentPreviousFollowUp')">
    <article v-for="item in meeting.previous_resolutions" :key="item.id" class="grid min-w-0 gap-2 px-(--webvue-card-pad) py-3">
      <UButton color="primary" variant="link" class="w-fit p-0 font-semibold whitespace-normal text-start" :to="`/meetings/${item.meeting_id}`">{{ item.meeting_name }}</UButton>
      <div class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <span class="text-highlighted">{{ item.name }}</span>
        <SharedStatusBadge v-bind="resolutionStateBadgeProps(item.state, t)" />
        <span class="text-muted">{{ formatMeetingDate(item.deadline, locale) }}</span>
      </div>
      <SharedRichText v-if="richTextHasContent(item.result)" :html="item.result" size="sm" />
      <UButton v-if="item.task_id" color="primary" variant="link" size="sm" class="w-fit p-0" :to="`/tasks/${item.task_id}`" target="_blank" rel="noopener" :label="t('meetingsUx.openTaskNewTab')" />
    </article>
  </SharedRecordSection>
</template>
