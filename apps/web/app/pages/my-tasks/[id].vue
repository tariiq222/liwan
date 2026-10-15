<script setup lang="ts">
import type { StatusTone } from '@/utils/statusTone'
import type { PersonalTask } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate, formatNasqDateTime } from '@/composables/calendarDate'
import { useMyTask, useMyTaskTransition, useUpdateMyTask, type MyTaskTransition } from '@/composables/useMyTasks'
import ConvertToProject from '@/components/personal-tasks/ConvertToProject.vue'
import MyTaskAttachments from '@/components/personal-tasks/MyTaskAttachments.vue'
import MyTaskComments from '@/components/personal-tasks/MyTaskComments.vue'
import MyTaskSubtasks from '@/components/personal-tasks/MyTaskSubtasks.vue'
import { owningListBack, recordEntryOrigin } from '@/utils/recordListOrigin'
import { changedFields, draftFromTask, type DetailDraft } from '@/utils/myTaskDetail'
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
const { mutateAsync: update, isPending: saving } = useUpdateMyTask()
const { mutateAsync: transition, isPending: transitioning } = useMyTaskTransition()

// A conversion removes the personal task from the cache and leaves for the project page; the last
// shape stays on screen meanwhile so the page does not flash a not-found state.
const lastTask = ref<PersonalTask | null>(null)
const converted = ref(false)
watch(data, (value) => { if (value) lastTask.value = value }, { immediate: true })
const task = computed(() => data.value ?? (converted.value ? lastTask.value : null))

const sourcePaths = useRecordListPaths(['/my-tasks'])
const returnTo = computed(() => {
  const fallback = router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath
  const parentPath = task.value?.parent ? `/my-tasks/${task.value.parent.id}` : undefined
  if (!parentPath) return fallback
  return recordEntryOrigin(route.query.returnTo, parentPath, sourcePaths.value) ?? fallback
})
const parentLink = computed(() => {
  const parent = task.value?.parent
  if (!parent) return null
  // Coming from the parent keeps its own way back to the list.
  return returnTo.value.split('?')[0] === `/my-tasks/${parent.id}` ? returnTo.value : `/my-tasks/${parent.id}`
})
const notFound = computed(() => taskId.value === null || (error.value instanceof ApiError && error.value.status === 404))


// --- inline edit -------------------------------------------------------------------------------
const editing = ref(false)
const draft = ref<DetailDraft | null>(null)
const fieldErrors = ref<Record<string, string>>({})
const formError = ref('')
const changes = computed(() => (task.value && draft.value ? changedFields(task.value, draft.value) : {}))
const dirty = computed(() => editing.value && Object.keys(changes.value).length > 0)
const knownAssignees = computed(() => (task.value?.assignees ?? []).map(person => ({ id: person.id, name: person.name })))
const priorityItems = computed(() => (['normal', 'high'] as const).map(value => ({ value, label: t(`myTasks.priority.${value}`) })))

function startEdit() {
  if (!task.value || !hydrated.value) return
  draft.value = draftFromTask(task.value)
  fieldErrors.value = {}
  formError.value = ''
  editing.value = true
}

function stopEdit() {
  editing.value = false
  draft.value = null
}

let savingNow = false

async function save() {
  const current = task.value
  if (savingNow || !current || !draft.value || saving.value) return
  fieldErrors.value = {}
  formError.value = ''
  if (!draft.value.name.trim()) {
    fieldErrors.value = { name: t('myTasks.form.nameRequired') }
    return
  }
  const body = changes.value
  if (!Object.keys(body).length) {
    stopEdit()
    return
  }
  savingNow = true
  try {
    await update({ id: current.id, body })
    stopEdit()
  } catch (e) {
    if (e instanceof ApiError && e.field) fieldErrors.value = { [e.field]: e.message }
    else formError.value = e instanceof ApiError ? e.message : t('myTasks.errors.save')
  } finally {
    savingNow = false
  }
}

// --- transitions (pending until the server answers) --------------------------------------------
const confirmingCancel = ref(false)
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
  nextTick(() => document.querySelector<HTMLElement>('[data-testid="inline-confirm-cancel"]')?.focus())
}

function keepTask() {
  confirmingCancel.value = false
  nextTick(() => document.querySelector<HTMLElement>('[data-my-task-cancel]')?.focus())
}

async function run(action: MyTaskTransition) {
  const current = task.value
  if (inFlight || !current || transitioning.value) return
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
    :back-label="t('myTasks.detail.back')"
    :loading="!task && !notFound && isLoading"
    :error="task || notFound ? null : error"
    @retry="refetch"
  >
    <template v-if="task" #actions>
      <span data-testid="my-task-state-live" aria-live="polite" aria-atomic="true">
        <SharedStatusBadge data-testid="my-task-state" :tone="STATE_TONE[task.state]" :label="t(`myTasks.state.${task.state}`)" />
      </span>
      <UButton v-if="task.allowed_actions.write && !editing" type="button" color="neutral" variant="outline" icon="i-lucide-pencil" :label="t('myTasks.actions.edit')" :disabled="!hydrated || saving" @click="startEdit" />
      <UButton v-if="task.allowed_actions.done" type="button" data-primary-action icon="i-lucide-check" :label="t('myTasks.actions.done')" :loading="transitioning" :disabled="!hydrated || transitioning" @click="run('done')" />
      <UButton v-if="task.allowed_actions.reopen" type="button" data-primary-action color="neutral" variant="outline" icon="i-lucide-rotate-ccw" :label="t('myTasks.actions.reopen')" :loading="transitioning" :disabled="!hydrated || transitioning" @click="run('reopen')" />
      <UButton v-if="task.allowed_actions.cancel && !confirmingCancel" type="button" data-my-task-cancel color="error" variant="ghost" icon="i-lucide-ban" :label="t('myTasks.actions.cancel')" :disabled="!hydrated || transitioning" @click="askCancel" />
    </template>

    <SharedEmptyState v-if="notFound" :title="t('myTasks.detail.notFound')" />
    <template v-else-if="task">
      <SharedInlineConfirm v-if="confirmingCancel" :title="t('myTasks.cancelConfirm.title')" :description="t('myTasks.cancelConfirm.body')" :confirm-label="t('myTasks.cancelConfirm.confirm')" :cancel-label="t('myTasks.cancelConfirm.keep')" :pending="transitioning" @confirm="run('cancel')" @cancel="keepTask" />
      <p v-if="actionError" role="alert" class="text-sm text-error">{{ actionError }}</p>
      <p v-if="parentLink" class="text-sm text-muted">
        {{ t('myTasks.subtasks.parentOf') }}
        <NuxtLink :to="parentLink" class="text-brand-link underline">{{ task.parent!.name }}</NuxtLink>
      </p>

      <SharedRecordSection :title="t('myTasks.detail.description')">
        <form v-if="editing && draft" class="grid gap-4" @submit.prevent="save">
          <UFormField :label="t('myTasks.form.name')" name="name" :error="fieldErrors.name" required>
            <UInput v-model="draft.name" class="w-full" :disabled="!hydrated || saving" />
          </UFormField>
          <UFormField :label="t('myTasks.form.description')" name="description" :error="fieldErrors.description">
            <UTextarea v-model="draft.description" class="w-full" :rows="4" :disabled="!hydrated || saving" />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('myTasks.form.deadline')" name="date_deadline" :error="fieldErrors.date_deadline">
              <SharedDateField v-model="draft.date_deadline" :aria-label="t('myTasks.form.deadline')" :disabled="saving" />
            </UFormField>
            <UFormField :label="t('myTasks.form.priority')" name="priority" :error="fieldErrors.priority">
              <USelect v-model="draft.priority" :items="priorityItems" class="w-full" :aria-label="t('myTasks.form.priority')" :disabled="!hydrated || saving" />
            </UFormField>
          </div>
          <UFormField :label="t('myTasks.form.assignees')" name="assignees" :error="fieldErrors.assignees">
            <SharedPersonPicker
              v-model="draft.assignees"
              multiple
              :known="knownAssignees"
              :placeholder="t('myTasks.form.assigneesPlaceholder')"
              :aria-label="t('myTasks.form.assignees')"
              :disabled="saving"
            />
          </UFormField>
          <p v-if="formError" role="alert" class="text-sm text-error">{{ formError }}</p>
          <SharedFormActions class="flex flex-wrap justify-end gap-2">
            <UButton type="button" color="neutral" variant="outline" :label="t('myTasks.form.cancel')" :disabled="!hydrated || saving" @click="stopEdit" />
            <UButton type="submit" :label="t('myTasks.form.save')" :loading="saving" :disabled="!hydrated || saving" />
          </SharedFormActions>
        </form>
        <p v-else class="whitespace-pre-wrap break-words text-sm text-default">{{ task.description || t('myTasks.detail.noDescription') }}</p>
      </SharedRecordSection>

      <MyTaskSubtasks v-if="!task.is_subtask" :task="task" />
      <MyTaskAttachments :task-id="task.id" :count="task.attachment_count" :can-write="task.allowed_actions.write" />
      <MyTaskComments :task-id="task.id" :can-write="task.allowed_actions.write" />
      <ConvertToProject v-if="task.allowed_actions.convert" :task-id="task.id" @converted="converted = true" />
    </template>
    <template v-if="task && !notFound" #summary>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('myTasks.detail.deadline')"><span data-testid="my-task-deadline">{{ deadlineText(task.date_deadline) }}</span></SharedPropertyRow>
        <SharedPropertyRow :label="t('myTasks.detail.priority')"><span data-testid="my-task-priority">{{ t(`myTasks.priority.${task.priority}`) }}</span></SharedPropertyRow>
        <SharedPropertyRow :label="t('myTasks.detail.assignees')" :value="task.assignees.map(person => person.name).join('، ') || t('myTasks.detail.noAssignees')" />
        <SharedPropertyRow :label="t('myTasks.detail.creator')" :value="task.creator.name" />
        <SharedPropertyRow :label="t('myTasks.detail.createdAt')" :value="formatNasqDateTime(task.created_at, locale)" />
        <SharedPropertyRow :label="t('myTasks.detail.updatedAt')" :value="formatNasqDateTime(task.updated_at, locale)" />
      </SharedPropertiesPanel>
    </template>
    <SharedUnsavedChanges :dirty="dirty" />
  </SharedRecordPage>
</template>
