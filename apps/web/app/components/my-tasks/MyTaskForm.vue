<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { isDirtySnapshot } from '@/lib/formDirty'
import {
  buildMyTaskPayload,
  deadlineToDateInput,
  MY_TASK_NAME_MAX,
  myTaskFormField,
  validateMyTaskName,
  type MyTaskFormValues,
} from '@/utils/myTaskPayload'

// One form for a personal task: the create page (`mode="create"`, empty) and the detail page's
// inline edit (`mode="edit"`, seeded from `initial`). It emits the exact request body and owns no
// request: the parent runs the mutation and passes `pending` and the failure back as `error`.
export interface MyTaskFormInitial {
  name: string
  description: string
  /** The wire value: a UTC instant `...Z` or null. */
  date_deadline: string | null
  priority: 'normal' | 'high'
  assignees: { id: number; name: string; user_id: number }[]
}

const props = withDefaults(defineProps<{
  mode?: 'create' | 'edit'
  initial?: MyTaskFormInitial | null
  pending?: boolean
  error?: Error | null
  submitLabel?: string
}>(), { mode: 'create', initial: null, pending: false, error: null, submitLabel: undefined })
const emit = defineEmits<{
  submit: [payload: ReturnType<typeof buildMyTaskPayload>]
  cancel: []
}>()

const { t } = useI18n()
const hydrated = useHydrated()

function seed(): MyTaskFormValues {
  const initial = props.initial
  return {
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    deadline: deadlineToDateInput(initial?.date_deadline),
    priority: initial?.priority ?? 'normal',
    assignees: (initial?.assignees ?? []).map(person => person.user_id),
  }
}

const values = reactive<MyTaskFormValues>(seed())
const known = computed(() => (props.initial?.assignees ?? []).map(person => ({ id: person.user_id, name: person.name })))
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
  if (nameProblem.value) return
  emit('submit', buildMyTaskPayload(values, props.mode))
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
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
        :known="known"
        :placeholder="t('myTasks.form.assigneesPlaceholder')"
        :aria-label="t('myTasks.form.assignees')"
        :disabled="pending"
      />
    </UFormField>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="pending" data-testid="my-task-form-cancel" @click="emit('cancel')">
        {{ t('myTasks.form.cancel') }}
      </UButton>
      <UButton type="submit" :loading="pending" :disabled="!hydrated || pending" data-testid="my-task-form-submit">
        {{ submitLabel ?? (mode === 'edit' ? t('myTasks.form.save') : t('myTasks.form.submit')) }}
      </UButton>
    </div>
  </form>
</template>
