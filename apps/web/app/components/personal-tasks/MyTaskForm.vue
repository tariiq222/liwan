<script setup lang="ts">
import type { PersonalTask } from '@webvue/contracts'
import type { MyTaskBody, MyTaskCreate } from '@/composables/useMyTasks'
import { changedFields } from '@/utils/myTaskDetail'
import { ApiError } from '@/composables/useApi'
import { isDirtySnapshot } from '@/lib/formDirty'
import {
  buildMyTaskPayload,
  MY_TASK_NAME_MAX,
  myTaskFormField,
  validateMyTaskName,
  type MyTaskFormValues,
} from '@/utils/myTaskPayload'

// One field form for personal task creation and editing. Pages own mutations and navigation;
// the initial server value remains the draft baseline until a confirmed save.
const props = withDefaults(defineProps<{
  task?: PersonalTask
  pending?: boolean
  error?: Error | null
}>(), { pending: false, error: null })
const emit = defineEmits<{
  create: [payload: MyTaskCreate]
  update: [payload: MyTaskBody]
  cancel: []
}>()

const { t } = useI18n()
const hydrated = useHydrated()

const initialTask = props.task ? { ...props.task, assignees: [...props.task.assignees] } : null
const values = reactive<MyTaskFormValues>(initialTask ? {
  name: initialTask.name, description: initialTask.description, deadline: initialTask.date_deadline?.slice(0, 10) ?? null,
  priority: initialTask.priority, assignees: initialTask.assignees.map(person => person.id),
} : { name: '', description: '', deadline: null, priority: 'normal', assignees: [] })
const knownAssignees = computed(() => initialTask?.assignees ?? [])
const baseline = ref(JSON.stringify(values))
const saved = ref(false)
const dirty = computed(() => isDirtySnapshot(baseline.value, JSON.stringify(values), saved.value))
// The parent calls this once the server confirmed the write, before it navigates away.
defineExpose({ markSaved: () => { saved.value = true } })

// The name input is disabled until hydration, so it takes focus only once it is live.
const nameInput = ref<{ inputRef?: HTMLInputElement | null } | null>(null)
function focusName() { nameInput.value?.inputRef?.focus() }
onMounted(() => { if (hydrated.value) focusName() })
watch(hydrated, async live => { if (live) { await nextTick(); focusName() } })

const priorityItems = computed(() => (['normal', 'high'] as const).map(value => ({ value, label: t(`myTasks.priority.${value}`) })))

const attempted = ref(false)
const nameProblem = computed(() => validateMyTaskName(values.name))
const localNameError = computed(() => attempted.value && nameProblem.value
  ? nameProblem.value === 'required'
    ? t('myTasks.form.nameRequired')
    : t('myTasks.form.nameTooLong', { max: MY_TASK_NAME_MAX })
  : undefined)

// Server errors belong under the field they name; anything else is a form-level alert.
const serverField = computed(() => props.error instanceof ApiError ? myTaskFormField(props.error.field) : null)
function serverError(field: string): string | undefined {
  return props.error && serverField.value === field ? props.error.message : undefined
}
const generalError = computed(() => props.error && !serverField.value ? props.error.message : null)

function submit() {
  if (!hydrated.value || props.pending) return
  attempted.value = true
  if (nameProblem.value) { nextTick(focusName); return }
  if (initialTask) emit('update', changedFields(initialTask, { ...values, date_deadline: values.deadline }))
  else emit('create', buildMyTaskPayload(values))
}
watch(() => props.error, async error => {
  if (!(error instanceof ApiError)) return
  const field = myTaskFormField(error.field)
  if (!field) return
  await nextTick()
  const id = ({ name: 'my-task-name', description: 'my-task-description', date_deadline: 'my-task-deadline', priority: 'my-task-priority', assignees: 'my-task-assignees' } as Record<string, string>)[field]!
  const element = document.getElementById(id)
  const control = element?.matches('input,textarea,button') ? element : element?.querySelector<HTMLElement>('input,textarea,button')
  ;(control as HTMLElement | null)?.focus()
}, { flush: 'post' })
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
  <form novalidate class="grid gap-5" data-testid="my-task-form" @submit.prevent="submit">
    <UAlert v-if="generalError" role="alert" color="error" variant="subtle" :title="generalError" data-testid="my-task-form-error" />
    <UFormField :label="t('myTasks.form.name')" name="name" required :error="localNameError ?? serverError('name')">
      <UInput
        id="my-task-name"
        ref="nameInput"
        v-model="values.name"
        class="w-full"
        required
        :maxlength="MY_TASK_NAME_MAX + 1"
        :placeholder="t('myTasks.form.namePlaceholder')"
        :disabled="!hydrated || pending"
      />
    </UFormField>
    <UFormField :label="t('myTasks.form.description')" name="description" :error="serverError('description')">
      <UTextarea id="my-task-description" v-model="values.description" class="w-full" :rows="4" :disabled="!hydrated || pending" />
    </UFormField>
    <div class="grid gap-5 sm:grid-cols-2">
      <UFormField :label="t('myTasks.form.deadline')" name="date_deadline" :error="serverError('date_deadline')">
        <SharedDateField id="my-task-deadline" v-model="values.deadline" :aria-label="t('myTasks.form.deadline')" :disabled="!hydrated || pending" />
      </UFormField>
      <UFormField :label="t('myTasks.form.priority')" name="priority" :error="serverError('priority')">
        <USelect id="my-task-priority" v-model="values.priority" class="w-full" :items="priorityItems" :disabled="!hydrated || pending" />
      </UFormField>
    </div>
    <UFormField :label="t('myTasks.form.assignees')" name="assignees" :error="serverError('assignees')">
      <SharedPersonPicker
        id="my-task-assignees"
        v-model="values.assignees"
        multiple
        value-key="user_id"
        :known="knownAssignees"
        :placeholder="t('myTasks.form.assigneesPlaceholder')"
        :aria-label="t('myTasks.form.assignees')"
        :disabled="pending"
      />
    </UFormField>
    <SharedFormActions class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || pending" data-testid="my-task-form-cancel" @click="emit('cancel')">
        {{ t('myTasks.form.cancel') }}
      </UButton>
      <UButton type="submit" :loading="pending" :disabled="!hydrated || pending" data-testid="my-task-form-submit">
        {{ t(initialTask ? 'myTasks.form.save' : 'myTasks.form.submit') }}
      </UButton>
    </SharedFormActions>
  </form>
</template>
