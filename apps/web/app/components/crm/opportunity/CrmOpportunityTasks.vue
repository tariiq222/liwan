<script setup lang="ts">
import type { CrmOpportunityTaskCreate, MyTaskListItem } from '@liwan/contracts'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'

// The follow-up tasks of one opportunity (the CRM bridge to the tasks application): state, deadline and assignees of
// each, with a link to the task's own page, and an inline form that adds a task. The page decides whether the section
// exists at all; `canWrite` shows the add form's button. The form asks for a name and a deadline; description,
// priority and assignees are optional (the server assigns the opportunity's agent when none is chosen).
const props = defineProps<{
  tasks: MyTaskListItem[]
  total: number
  loading?: boolean
  error?: unknown
  canWrite: boolean
  pending?: boolean
  formError?: string
}>()
const emit = defineEmits<{ create: [body: CrmOpportunityTaskCreate]; retry: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const STATE_TONE = { open: 'info', done: 'success', cancelled: 'destructive' } as const
const adding = ref(false)
const attempted = ref(false)
const name = ref('')
const deadline = ref<string | null>(null)
const description = ref('')
const priority = ref<'normal' | 'high'>('normal')
const assignees = ref<number[]>([])
const priorityItems = computed(() => (['normal', 'high'] as const).map(value => ({ value, label: t(`crm.opportunities.tasks.priority.${value}`) })))
const locked = computed(() => !hydrated.value || props.pending)

function reset() {
  adding.value = false
  attempted.value = false
  name.value = ''
  deadline.value = null
  description.value = ''
  priority.value = 'normal'
  assignees.value = []
}

function submit() {
  attempted.value = true
  const trimmed = name.value.trim()
  if (!trimmed || !deadline.value) return
  const body: CrmOpportunityTaskCreate = { name: trimmed, date_deadline: deadline.value, priority: priority.value }
  if (description.value.trim()) body.description = description.value.trim()
  if (assignees.value.length) body.assignees = [...assignees.value]
  emit('create', body)
}

defineExpose({ reset })
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('crm.opportunities.tasks.title')" data-testid="crm-tasks">
    <template v-if="canWrite && !adding" #actions>
      <UButton size="xs" variant="outline" icon="i-lucide-plus" :label="t('crm.opportunities.tasks.add')" :disabled="!hydrated" data-testid="crm-task-add" @click="adding = true" />
    </template>
    <div class="grid gap-4">
      <UForm v-if="adding" novalidate :state="{}" class="liwan-form" data-testid="crm-task-form" @submit="submit">
        <UFormField :label="t('crm.opportunities.tasks.name')" name="task-name" required :error="attempted && !name.trim() ? t('crm.opportunities.tasks.nameRequired') : undefined">
          <UInput id="crm-task-name" v-model="name" class="w-full" :maxlength="255" :disabled="locked" />
        </UFormField>
        <div class="liwan-auto-grid gap-5">
          <UFormField :label="t('crm.opportunities.tasks.deadline')" name="task-deadline" required :error="attempted && !deadline ? t('crm.opportunities.tasks.deadlineRequired') : undefined">
            <SharedDateField id="crm-task-deadline" v-model="deadline" :aria-label="t('crm.opportunities.tasks.deadline')" :disabled="locked" />
          </UFormField>
          <UFormField :label="t('crm.opportunities.tasks.priorityLabel')" name="task-priority">
            <USelect id="crm-task-priority" v-model="priority" class="w-full" :items="priorityItems" :disabled="locked" />
          </UFormField>
        </div>
        <UFormField :label="t('crm.opportunities.tasks.description')" name="task-description">
          <UTextarea id="crm-task-description" v-model="description" class="w-full" :rows="3" :disabled="locked" />
        </UFormField>
        <UFormField :label="t('crm.opportunities.tasks.assignees')" name="task-assignees" :description="t('crm.opportunities.tasks.assigneesHint')">
          <SharedPersonPicker id="crm-task-assignees" v-model="assignees" multiple value-key="user_id" :placeholder="t('crm.opportunities.tasks.assigneesPlaceholder')" :aria-label="t('crm.opportunities.tasks.assignees')" :disabled="props.pending" />
        </UFormField>
        <UAlert v-if="formError" role="alert" color="error" variant="subtle" :description="formError" data-testid="crm-task-error" />
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" :label="t('app.cancel')" :disabled="locked" @click="reset" />
          <UButton type="submit" :loading="props.pending" :disabled="locked" :label="t('crm.opportunities.tasks.submit')" data-testid="crm-task-submit" />
        </div>
      </UForm>
      <SharedPageState empty-icon="i-lucide-check-square" :loading="loading" :error="error" :empty="!tasks.length" :empty-text="t('crm.opportunities.tasks.empty')" @retry="emit('retry')">
        <ul class="divide-y divide-default" data-testid="crm-task-list">
          <li v-for="task in tasks" :key="task.id" class="grid gap-1 py-3 first:pt-0 last:pb-0">
            <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <NuxtLink :to="task.href" class="min-w-0 truncate font-semibold text-primary hover:underline">{{ task.name }}</NuxtLink>
              <SharedStatusBadge :tone="STATE_TONE[task.state]" :label="t(`crm.opportunities.tasks.state.${task.state}`)" size="sm" />
              <span v-if="task.priority === 'high'" class="text-xs text-warning">{{ t('crm.opportunities.tasks.priority.high') }}</span>
            </div>
            <p class="flex flex-wrap gap-x-3 text-sm text-muted">
              <span>{{ task.date_deadline ? t('crm.opportunities.tasks.due', { date: formatCalendarDate(task.date_deadline) }) : t('crm.opportunities.tasks.noDeadline') }}</span>
              <span v-if="task.assignees.length">{{ task.assignees.map(person => person.name).join('، ') }}</span>
            </p>
          </li>
        </ul>
        <p v-if="total > tasks.length" class="mt-3 border-t border-default pt-3 text-sm text-muted">{{ t('crm.opportunities.tasks.count', { shown: tasks.length, total }) }}</p>
      </SharedPageState>
    </div>
  </SharedRecordSection>
</template>
