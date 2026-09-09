<script setup lang="ts">
import DescriptionEditor from '@/components/task/DescriptionEditor.vue'
import MeetingProjectFilter from '@/components/meetings/MeetingProjectFilter.vue'
import { useMeeting, usePatchResolution } from '@/composables/useMeetings'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const meetingId = computed(() => Number(route.params.id))
const resolutionId = computed(() => Number(route.params.resolutionId))
const query = useMeeting(meetingId)
const { mutateAsync, isPending, error } = usePatchResolution()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/meetings/${meetingId.value}`, ['/meetings']))
const resolution = computed(() => query.data.value?.resolutions.find(item => item.id === resolutionId.value) ?? null)
const knownPeople = computed(() => {
  const meeting = query.data.value
  if (!meeting) return []
  const people = [meeting.organizer, meeting.secretary, ...meeting.attendees, resolution.value?.responsible]
  return [...new Map(
    people
      .filter((person): person is { id: number; name: string } => Boolean(person))
      .map(person => [person.id, person] as const),
  ).values()]
})
const canEditDecision = computed(() => !!resolution.value?.can_edit_decision)
const canEditResult = computed(() => {
  const item = resolution.value
  if (!item) return false
  if (Array.isArray(item.allowed_actions)) return item.allowed_actions.includes('edit_result')
  return Boolean(item.can_update_execution) && !item.task_linked && !['done', 'cancelled'].includes(String(item.execution_state ?? item.state))
})
const canSave = computed(() => hydrated.value && (canEditDecision.value || canEditResult.value))
const name = ref('')
const responsibleId = ref<number | ''>('')
const deadline = ref('')
const executionPeriod = ref('')
const projectId = ref<number | undefined>(undefined)
const priority = ref<'0' | '1' | '2' | '3'>('0')
const result = ref('')
const loaded = ref(false)
const baseline = ref('')

function snapshot() {
  return JSON.stringify([name.value, responsibleId.value, deadline.value, executionPeriod.value, projectId.value, priority.value, result.value])
}

watch(resolution, (item) => {
  if (!item || loaded.value) return
  name.value = item.name
  responsibleId.value = item.responsible?.id ?? ''
  deadline.value = item.deadline ?? ''
  executionPeriod.value = item.execution_period ?? ''
  projectId.value = item.project?.id
  priority.value = item.priority
  result.value = item.result
  baseline.value = snapshot()
  loaded.value = true
}, { immediate: true })

const dirty = computed(() => loaded.value && snapshot() !== baseline.value)
const validationMessage = computed(() => {
  if (!canEditDecision.value) return ''
  if (!name.value.trim()) return t('meetingsUx.validation.resolutionName')
  if (!responsibleId.value) return t('meetingsUx.validation.responsible')
  if (!deadline.value && !executionPeriod.value.trim()) return t('meetingMinutesForm.validation.deadlineOrPeriod')
  return ''
})

async function save() {
  if (!canSave.value || !dirty.value || (canEditDecision.value && (!name.value.trim() || !responsibleId.value || (!deadline.value && !executionPeriod.value.trim())))) return
  const body: Record<string, unknown> = {}
  if (canEditDecision.value) {
    body.name = name.value.trim()
    if (responsibleId.value) body.responsible_id = Number(responsibleId.value)
    body.deadline = deadline.value || null
    body.execution_period = executionPeriod.value.trim()
    body.project_id = projectId.value ?? null
    body.priority = priority.value
  }
  if (canEditResult.value) body.result = result.value
  if (!Object.keys(body).length) return
  await mutateAsync({ meetingId: meetingId.value, resolutionId: resolutionId.value, body })
  baseline.value = snapshot()
  await nextTick()
  await navigateTo(returnTo.value)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUi.editResolution')" :back-to="returnTo" />
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && !resolution" @retry="query.refetch">
      <div v-if="resolution && !canEditDecision && !canEditResult" class="nasq-panel nasq-panel-body text-sm text-muted-foreground">
        {{ t('meetingsUi.resolutionReadOnly') }}
      </div>
      <form v-else-if="resolution" class="nasq-form nasq-panel nasq-panel-body grid gap-4" @submit.prevent="save">
        <SharedUnsavedChanges :dirty="dirty" />
        <SharedFormSection v-if="canEditDecision" :title="t('meetingsUi.resolutions')" class="grid gap-4">
          <div class="grid gap-2">
            <Label for="resolution-name">{{ t('meetingsUi.resolutionTitle') }}</Label>
            <Input id="resolution-name" v-model="name" :disabled="!hydrated || isPending" required />
          </div>
          <div class="grid gap-2">
            <Label for="resolution-user">{{ t('meetingsUi.responsible') }}</Label>
            <select id="resolution-user" v-model="responsibleId" class="border-input h-9 w-full min-w-0 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || isPending" required>
              <option value="">{{ t('meetingsUi.responsible') }}</option>
              <option v-for="person in knownPeople" :key="person.id" :value="person.id">{{ person.name }}</option>
            </select>
          </div>
          <div class="grid gap-2">
            <Label for="resolution-deadline">{{ t('meetingsUi.deadline') }}</Label>
            <Input id="resolution-deadline" v-model="deadline" type="date" :disabled="!hydrated || isPending" />
            <p class="text-xs text-muted-foreground">{{ t('meetingMinutesForm.deadlineOrPeriodHint') }}</p>
          </div>
          <div class="grid gap-2">
            <Label for="resolution-period">{{ t('meetingMinutesForm.executionPeriod') }}</Label>
            <Input id="resolution-period" v-model="executionPeriod" maxlength="500" :disabled="!hydrated || isPending" :placeholder="t('meetingMinutesForm.executionPeriodPlaceholder')" />
          </div>
          <div class="grid gap-2 sm:col-span-2">
            <Label for="resolution-project">{{ t('meetingMinutesForm.project') }}</Label>
            <MeetingProjectFilter id="resolution-project" hide-label :model-value="projectId" :disabled="!hydrated || isPending" @update:model-value="projectId = $event" />
          </div>
          <div class="grid gap-2">
            <Label for="resolution-priority">{{ t('meetingsUi.priority') }}</Label>
            <select id="resolution-priority" v-model="priority" class="border-input h-9 w-full min-w-0 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || isPending">
              <option v-for="code in ['0', '1', '2', '3']" :key="code" :value="code">{{ t(`meetingsUx.priorityLabel.${code}`) }}</option>
            </select>
          </div>
        </SharedFormSection>
        <SharedFormSection v-if="canEditResult" :title="t('meetingsUi.result')">
          <ClientOnly>
            <DescriptionEditor :model-value="result" :task-id="0" :readonly="isPending" :aria-label="t('meetingsUx.completionNotes')" @draft="result = $event.html" />
          </ClientOnly>
        </SharedFormSection>
        <p v-if="validationMessage" class="text-sm text-muted-foreground" aria-live="polite">{{ validationMessage }}</p>
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ error.message }}</p>
        <div class="flex justify-end gap-2">
          <NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
          <Button type="submit" :disabled="!canSave || isPending || !dirty || Boolean(validationMessage)">{{ t('app.save') }}</Button>
        </div>
      </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
