<script setup lang="ts">
import type { Milestone } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useCreateMilestone, useUpdateMilestone } from '@/composables/useMilestones'
import { isDirtySnapshot } from '@/lib/formDirty'
import { validateMilestoneDates } from '@/utils/projectDateBounds'
import { buildMilestonePatch } from '@/utils/milestonePayload'

const props = defineProps<{
  projectId: number
  milestone?: Milestone
  projectStart?: string | null
  projectEnd?: string | null
}>()
const emit = defineEmits<{ saved: [id?: number]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: createMutate, isPending: creating } = useCreateMilestone()
const { mutateAsync: updateMutate, isPending: updating } = useUpdateMilestone()
const isEdit = computed(() => !!props.milestone)
const isPending = computed(() => creating.value || updating.value)
const name = ref(props.milestone?.name ?? '')
const startDate = ref<string | null>(props.milestone?.start_date ?? null)
const deadline = ref<string | null>(props.milestone?.deadline ?? null)
const deliverables = ref<Array<{ name: string; done: boolean }>>([])
const error = ref<string | null>(null)
const projectScheduleMissing = ref(false)
const submitted = ref(false)
const attempted = ref(false)
const requiredError = computed(() => attempted.value && !name.value.trim() ? t('projects.milestones.nameRequired') : undefined)
const baseline = ref('')

function state() {
  return JSON.stringify([name.value, startDate.value, deadline.value, deliverables.value])
}

const dirty = computed(() => isDirtySnapshot(baseline.value, state(), submitted.value))

watch(() => props.milestone, (milestone) => {
  name.value = milestone?.name ?? ''
  startDate.value = milestone?.start_date ?? null
  deadline.value = milestone?.deadline ?? null
  deliverables.value = (milestone?.deliverables ?? []).map(item => ({ name: item.name, done: item.done }))
  submitted.value = false
  attempted.value = false
  baseline.value = state()
}, { immediate: true, flush: 'sync' })

function addDeliverable() { deliverables.value.push({ name: '', done: false }) }
function removeDeliverable(index: number) { deliverables.value.splice(index, 1) }

const dateError = computed(() => validateMilestoneDates({
  projectStart: props.projectStart,
  projectEnd: props.projectEnd,
  startDate: startDate.value,
  deadline: deadline.value,
}))

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = null
  projectScheduleMissing.value = false
  const trimmed = name.value.trim()
  if (!trimmed) return
  if (!props.milestone && (!props.projectStart || !props.projectEnd || !startDate.value || !deadline.value)) {
    error.value = t('projects.milestones.scheduleRequired')
    projectScheduleMissing.value = !props.projectStart || !props.projectEnd
    return
  }
  const nextStartDate = startDate.value
  const nextDeadline = deadline.value
  const datesChanged = !props.milestone || nextStartDate !== (props.milestone.start_date ?? null) || nextDeadline !== (props.milestone.deadline ?? null)
  if (datesChanged && dateError.value) {
    error.value = t(`projects.milestones.${dateError.value.split('.').pop()}`)
    return
  }
  const output = deliverables.value.map(item => ({ name: item.name.trim(), done: item.done })).filter(item => item.name)
  try {
    if (props.milestone) {
      await updateMutate({ projectId: props.projectId, id: props.milestone.id, patch: buildMilestonePatch({ name: trimmed, startDate: nextStartDate, deadline: nextDeadline, deliverables: output, originalStartDate: props.milestone.start_date, originalDeadline: props.milestone.deadline, isNew: false }) })
      submitted.value = true
      emit('saved', props.milestone.id)
    } else {
      const created = await createMutate({ projectId: props.projectId, name: trimmed, start_date: startDate.value, deadline: deadline.value, deliverables: output })
      submitted.value = true
      emit('saved', created.id)
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <form novalidate data-testid="milestone-form" class="grid gap-5" @submit.prevent="submit">
    <div v-if="error" class="text-sm text-error sm:col-span-2">
      <UAlert role="alert" color="error" variant="subtle" :title="error" />
      <NuxtLink v-if="projectScheduleMissing" class="mt-1 inline-block underline underline-offset-4" :to="{ path: `/projects/${props.projectId}/charter`, query: { edit: '1' } }">{{ t('projects.milestones.openProjectFile') }}</NuxtLink>
    </div>
    <UFormField :label="t('projects.milestones.name')" required :error="requiredError">
      <UInput id="milestone-name" v-model="name" class="w-full" required :disabled="!hydrated || isPending" />
    </UFormField>
    <UFormField>
      <template #label><span id="milestone-start-label">{{ t('projects.milestones.startDate') }}</span></template>
      <SharedDateField :min-value="projectStart" :max-value="projectEnd" v-model="startDate" :disabled="!hydrated || isPending" aria-labelledby="milestone-start-label" :aria-label="t('projects.milestones.startDate')" />
    </UFormField>
    <UFormField>
      <template #label><span id="milestone-deadline-label">{{ t('projects.milestones.deadline') }}</span></template>
      <SharedDateField :min-value="projectStart" :max-value="projectEnd" v-model="deadline" :disabled="!hydrated || isPending" aria-labelledby="milestone-deadline-label" :aria-label="t('projects.milestones.deadline')" />
    </UFormField>
    <UFormField class="sm:col-span-2" :label="t('projects.milestones.deliverables')" :description="t('projects.milestones.deliverablesHint')">
      <template #hint>
        <UButton type="button" color="neutral" variant="outline" size="sm" icon="i-lucide-plus" :disabled="!hydrated || isPending" :label="t('projects.milestones.addDeliverable')" @click="addDeliverable" />
      </template>
      <div v-if="deliverables.length" class="space-y-2">
        <div v-for="(item, index) in deliverables" :key="index" class="flex items-center gap-2">
          <USwitch :model-value="item.done" :aria-label="t('projects.milestones.deliverableDone')" :disabled="!hydrated || isPending" @update:model-value="item.done = $event" />
          <UInput v-model="item.name" class="w-full" :aria-label="t('projects.milestones.deliverableName')" :disabled="!hydrated || isPending" />
          <UButton type="button" color="neutral" variant="ghost" square icon="i-lucide-x" size="sm" :disabled="!hydrated || isPending" :aria-label="t('projects.milestones.removeDeliverable')" @click="removeDeliverable(index)" />
        </div>
      </div>
      <p v-else class="text-sm text-muted">{{ t('projects.milestones.noDeliverables') }}</p>
    </UFormField>
    <SharedFormActions class="flex flex-wrap gap-2 justify-end sm:col-span-2">
      <UButton type="button" color="neutral" :disabled="isPending" :label="t('app.cancel')" @click="emit('cancel')" variant="outline" />
      <UButton type="submit" :disabled="!hydrated || isPending" :loading="isPending" :label="isEdit ? t('app.save') : t('app.create')" />
    </SharedFormActions>
  </form>
</template>
