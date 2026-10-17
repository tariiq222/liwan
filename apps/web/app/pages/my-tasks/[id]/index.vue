<script setup lang="ts">
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'
import type { PersonalTask } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate, formatWebVueDateTime } from '@webvue/ui/app/composables/calendarDate'
import { useMyTask, useMyTaskTransition, type MyTaskTransition } from '@/composables/useMyTasks'
import ConvertToProject from '@/components/personal-tasks/ConvertToProject.vue'
import MyTaskAttachments from '@/components/personal-tasks/MyTaskAttachments.vue'
import MyTaskComments from '@/components/personal-tasks/MyTaskComments.vue'
import MyTaskSubtasks from '@/components/personal-tasks/MyTaskSubtasks.vue'
import { owningListBack, recordEntryOrigin } from '@/utils/recordListOrigin'
import { deadlineDay } from '@/utils/myTaskList'

const STATE_TONE: Record<PersonalTask['state'], StatusTone> = { open: 'info', done: 'success', cancelled: 'neutral' }

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()

const taskId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data, isLoading, error, refetch } = useMyTask(taskId)
const { mutateAsync: transition, isPending: transitioning } = useMyTaskTransition()

// A conversion removes the personal task from the cache and leaves for the project page; the last
// shape stays on screen meanwhile so the page does not flash a not-found state.
const lastTask = ref<PersonalTask | null>(null)
const converted = ref(false)
const drafts = reactive({ comments: false, subtasks: false })
const pending = reactive({ comments: false, subtasks: false, attachments: false })
const discardDraftKey = ref(0)
const convertPending = ref(false)
const hasDraft = computed(() => Object.values(drafts).some(Boolean))
const pendingElsewhere = computed(() => Object.values(pending).some(Boolean))
const guarded = computed(() => hasDraft.value || pendingElsewhere.value || (convertPending.value && !converted.value))
watch(taskId, () => { Object.assign(drafts, { comments: false, subtasks: false }); Object.assign(pending, { comments: false, subtasks: false, attachments: false }); converted.value = false })
async function prepareConvert() {
  if (pendingElsewhere.value) return false
  discardDraftKey.value++
  await nextTick()
  return !hasDraft.value && !pendingElsewhere.value
}
function closeConvert() { convertOpen.value = false; nextTick(() => moreAction.value?.querySelector('button')?.focus()) }
function resumeWriting() {
  convertOpen.value = false
  nextTick(() => document.querySelector<HTMLElement>(drafts.comments ? '[data-testid="my-task-comments"] textarea' : '[data-testid="my-task-subtasks"] input')?.focus())
}
watch(data, (value) => { if (value) lastTask.value = value }, { immediate: true })
const task = computed(() => data.value ?? (converted.value ? lastTask.value : null))

const sourcePaths = useRecordListPaths(['/my-tasks'])
const returnTo = computed(() => {
  const fallback = router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath
  const parentPath = task.value?.parent ? `/my-tasks/${task.value.parent.id}` : undefined
  if (!parentPath) return fallback
  return recordEntryOrigin(route.query.returnTo, parentPath, sourcePaths.value) ?? fallback
})
const backLabel = computed(() => {
  const source = new URL(returnTo.value, 'http://webvue.local').pathname
  if (task.value?.parent && source === `/my-tasks/${task.value.parent.id}`) return t('myTasks.detail.backToParent', { name: task.value.parent.name })
  return source === '/my-tasks' ? t('myTasks.detail.back') : t('myTasks.detail.backToSource')
})
const parentLink = computed(() => {
  const parent = task.value?.parent
  if (!parent) return null
  // Coming from the parent keeps its own way back to the list.
  return returnTo.value.split('?')[0] === `/my-tasks/${parent.id}` ? returnTo.value : `/my-tasks/${parent.id}`
})
const pageError = computed(() => taskId.value === null ? new ApiError(404, 'not_found', t('errors.notFound')) : error.value)


const editTo = computed(() => ({ path: `/my-tasks/${taskId.value}/edit`, query: { listOrigin: returnTo.value } }))

// --- transitions (pending until the server answers) --------------------------------------------
const confirmingCancel = ref(false)
const convertOpen = ref(false)
const moreAction = ref<HTMLElement | null>(null)
const secondaryActions = computed(() => {
  const actions = []
  if (task.value?.allowed_actions.convert) actions.push({ label: t('myTasks.convert.title'), icon: 'i-lucide-folder-kanban', onSelect: () => { convertOpen.value = true } })
  if (task.value?.allowed_actions.cancel) actions.push({ label: t('myTasks.actions.cancel'), icon: 'i-lucide-ban', color: 'error' as const, disabled: hasDraft.value || pendingElsewhere.value, onSelect: askCancel })
  return actions
})
function focusCancel() { document.querySelector<HTMLElement>('[data-testid="inline-confirm-cancel"]')?.focus() }
const menuContent = { align: 'end' as const, onCloseAutoFocus(event: Event) {
  if (confirmingCancel.value) { event.preventDefault(); nextTick(focusCancel) }
  else if (convertOpen.value) { event.preventDefault(); nextTick(() => document.querySelector<HTMLElement>('[data-testid="my-task-convert"] button[aria-haspopup="listbox"]')?.focus()) }
} }
const actionError = ref('')

// A plain flag, set before the first await: `isPending` of the mutation reaches a guard a
// macrotask late, so it alone cannot stop a second click from sending a second transition.
let inFlight = false
// The controls swap with the state: focus follows to the new primary control (or the heading)
// once the server's state is on the page and the mutation has settled.
const focusAfterState = ref(false)

function focusPrimary() {
  const target = document.querySelector<HTMLElement>('[data-primary-action]') ?? document.querySelector<HTMLElement>('h1')
  if (!target) return
  if (!target.matches('button, a, input, textarea, select')) target.tabIndex = -1
  target.focus()
}

// A pending button is disabled and cannot take focus, so this waits for the mutation to settle.
watch(transitioning, async (busy) => {
  if (busy || !focusAfterState.value) return
  focusAfterState.value = false
  await nextTick()
  focusPrimary()
}, { flush: 'post' })

function askCancel() {
  confirmingCancel.value = true
  nextTick(focusCancel)
}

function keepTask() {
  confirmingCancel.value = false
  nextTick(() => moreAction.value?.querySelector('button')?.focus())
}

async function run(action: MyTaskTransition) {
  const current = task.value
  if (inFlight || !current || transitioning.value || hasDraft.value || pendingElsewhere.value || convertPending.value) return
  inFlight = true
  actionError.value = ''
  focusAfterState.value = true
  try {
    await transition({ id: current.id, action })
  } catch (e) {
    focusAfterState.value = false
    actionError.value = e instanceof ApiError ? e.message : t('myTasks.errors.transition')
  } finally {
    confirmingCancel.value = false
    inFlight = false
  }
}

const title = computed(() => task.value?.name ?? t('myTasks.title'))
const deadlineText = (value: string | null) => formatCalendarDate(deadlineDay(value), locale.value) || t('myTasks.detail.noDeadline')
</script>

<template>
  <SharedRecordPage :keep-content="!!task"
    data-testid="my-task-detail"
    :title="title"
    :back-to="returnTo"
    :back-label="backLabel"
    :loading="!task && isLoading"
    :error="pageError"
    @retry="refetch"
  >
    <template v-if="task" #actions>
      <span data-testid="my-task-state-live" aria-live="polite" aria-atomic="true">
        <SharedStatusBadge data-testid="my-task-state" :tone="STATE_TONE[task.state]" :label="t(`myTasks.state.${task.state}`)" />
      </span>
      <UButton v-if="task.allowed_actions.write" type="button" color="neutral" variant="outline" icon="i-lucide-pencil" :label="t('myTasks.actions.edit')" :disabled="!hydrated || transitioning || convertPending" :to="editTo" />
      <UButton v-if="task.allowed_actions.done" type="button" data-primary-action icon="i-lucide-check" :label="t('myTasks.actions.done')" :loading="transitioning" :disabled="!hydrated || transitioning || convertPending || hasDraft || pendingElsewhere" @click="run('done')" />
      <UButton v-if="task.allowed_actions.reopen" type="button" data-primary-action color="neutral" variant="outline" icon="i-lucide-rotate-ccw" :label="t('myTasks.actions.reopen')" :loading="transitioning" :disabled="!hydrated || transitioning || convertPending || hasDraft || pendingElsewhere" @click="run('reopen')" />
      <div v-if="secondaryActions.length" ref="moreAction">
        <UDropdownMenu :items="secondaryActions" :content="menuContent">
          <UButton type="button" color="neutral" variant="outline" icon="i-lucide-ellipsis" :label="t('myTasks.actions.more')" :disabled="!hydrated || transitioning || convertPending" />
        </UDropdownMenu>
      </div>
    </template>

    <template v-if="task">
      <SharedInlineConfirm v-if="confirmingCancel" :title="t('myTasks.cancelConfirm.title')" :description="t('myTasks.cancelConfirm.body')" :confirm-label="t('myTasks.cancelConfirm.confirm')" :cancel-label="t('myTasks.cancelConfirm.keep')" :pending="transitioning" @confirm="run('cancel')" @cancel="keepTask" />
      <p v-if="hasDraft" role="status" class="text-sm text-muted">{{ t('myTasks.draftBeforeState') }}</p>
      <p v-if="pendingElsewhere || convertPending" role="status" class="text-sm text-muted">{{ t('myTasks.pendingWork') }}</p>
      <p v-if="actionError" role="alert" class="text-sm text-error">{{ actionError }}</p>
      <p v-if="parentLink" class="text-sm text-muted">
        {{ t('myTasks.subtasks.parentOf') }}
        <NuxtLink :to="parentLink" class="text-brand-link underline">{{ task.parent!.name }}</NuxtLink>
      </p>

      <SharedRecordSection variant="panel" :title="t('myTasks.detail.description')">
        <p class="whitespace-pre-wrap break-words text-sm text-default">{{ task.description || t('myTasks.detail.noDescription') }}</p>
      </SharedRecordSection>

      <MyTaskSubtasks v-if="!task.is_subtask" :key="`subtasks-${task.id}`" :task="task" :disabled="convertPending" :discard-draft-key="discardDraftKey" @draft-change="drafts.subtasks = $event" @pending-change="pending.subtasks = $event" />
      <MyTaskAttachments :key="`attachments-${task.id}`" :task-id="task.id" :count="task.attachment_count" :can-write="task.allowed_actions.write && !convertPending" @pending-change="pending.attachments = $event" />
      <MyTaskComments :key="`comments-${task.id}`" :task-id="task.id" :can-write="task.allowed_actions.write && !convertPending" :discard-draft-key="discardDraftKey" @draft-change="drafts.comments = $event" @pending-change="pending.comments = $event" />
      <ConvertToProject v-if="task.allowed_actions.convert" :key="`convert-${task.id}`" :task-id="task.id" :open="convertOpen" :has-draft="hasDraft" :pending-elsewhere="pendingElsewhere || transitioning" :prepare-convert="prepareConvert" @converted="converted = true" @pending-change="convertPending = $event" @close="closeConvert" @resume-writing="resumeWriting" />
      <SharedRecordSection variant="tinted" :title="t('myTasks.detail.info')">
        <SharedPropertiesPanel>
          <SharedPropertyRow :label="t('myTasks.detail.creator')" :value="task.creator.name" />
          <SharedPropertyRow :label="t('myTasks.detail.createdAt')" :value="formatWebVueDateTime(task.created_at, locale)" />
          <SharedPropertyRow :label="t('myTasks.detail.updatedAt')" :value="formatWebVueDateTime(task.updated_at, locale)" />
        </SharedPropertiesPanel>
      </SharedRecordSection>
    </template>
    <template v-if="task" #summary>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('myTasks.detail.deadline')"><span data-testid="my-task-deadline">{{ deadlineText(task.date_deadline) }}</span></SharedPropertyRow>
        <SharedPropertyRow :label="t('myTasks.detail.priority')"><span data-testid="my-task-priority">{{ t(`myTasks.priority.${task.priority}`) }}</span></SharedPropertyRow>
        <SharedPropertyRow :label="t('myTasks.detail.assignees')" :value="task.assignees.map(person => person.name).join('، ') || t('myTasks.detail.noAssignees')" />
      </SharedPropertiesPanel>
    </template>
    <SharedUnsavedChanges :dirty="guarded" guard-route-updates />
  </SharedRecordPage>
</template>
