<script setup lang="ts">
import type { OperationProcess, OperationProcessBody } from '@webvue/contracts'
import { createOperationSubmitGuard, operationErrorKey, processFormErrors } from '@/composables/operations/forms'
import { useOperationExecutionKinds } from '@/composables/operations/useOperations'

const props = defineProps<{ process?: OperationProcess; disabled?: boolean; backTo: string; refresh?: () => Promise<OperationProcess>; save: (body: OperationProcessBody) => Promise<OperationProcess> }>()
const emit = defineEmits<{ saved: [process: OperationProcess] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const name = ref(props.process?.name ?? '')
const description = ref(props.process?.description ?? '')
const executionKind = ref(props.process?.execution_kind ?? 'approval')
const acceptedRevision = ref(props.process?.revision)
const steps = ref((props.process?.steps ?? [{ name: '', reviewer_ids: [], reviewers: [] }]).map(step => ({ name: step.name, reviewer_ids: [...step.reviewer_ids], reviewers: [...step.reviewers] })))
const kinds = useOperationExecutionKinds()
const attempted = ref(false)
const error = ref<unknown>(null)
const reloadRequested = ref(false)
const gate = createOperationSubmitGuard()
const pending = gate.pending
function snapshot() { return JSON.stringify([name.value, description.value, executionKind.value, steps.value.map(step => [step.name, step.reviewer_ids])]) }
const baseline = ref(snapshot())
const dirty = computed(() => snapshot() !== baseline.value)
const errors = computed(() => processFormErrors({ name: name.value, steps: steps.value }))
function fieldError(field: string) {
  const client = attempted.value ? errors.value[field] : undefined
  const server = error.value as { field?: string; message?: string } | null
  return client ? t(`operations.errors.${client}`) : server?.field === field ? server.message : undefined
}
const disabled = computed(() => !hydrated.value || pending.value || props.disabled)
const kindItems = computed(() => (kinds.data.value?.items ?? []).map(value => ({ value, label: t(`operations.executionKinds.${value === 'approval' || value === 'pmo_completion' ? value : 'other'}`) })))
function move(index: number, delta: number) {
  if (disabled.value) return
  const next = index + delta
  if (next < 0 || next >= steps.value.length) return
  const current = steps.value[index]!
  steps.value[index] = steps.value[next]!
  steps.value[next] = current
}
function setReviewers(index: number, value: number | number[] | null) { if (!disabled.value) steps.value[index]!.reviewer_ids = Array.isArray(value) ? value : [] }
async function submit() {
  if (disabled.value || kinds.isPending.value || kinds.error.value) return
  attempted.value = true
  if (Object.keys(errors.value).length) return
  await gate.run(async () => {
    error.value = null
    try {
      const body: OperationProcessBody = { name: name.value.trim(), description: description.value, execution_kind: executionKind.value, steps: steps.value.map(step => ({ name: step.name.trim(), reviewer_ids: [...new Set(step.reviewer_ids)] })) }
      if (props.process) body.revision = acceptedRevision.value
      const process = await props.save(body)
      acceptedRevision.value = process.revision
      baseline.value = snapshot()
      await nextTick()
      emit('saved', process)
    } catch (e) { error.value = e }
  })
}
async function requestReload() {
  if (dirty.value) reloadRequested.value = true
  else await reload()
}
async function reload() {
  if (disabled.value || !props.refresh) return
  await gate.run(async () => {
    try {
      const current = await props.refresh!()
      name.value = current.name; description.value = current.description; executionKind.value = current.execution_kind
      steps.value = current.steps.map(step => ({ name: step.name, reviewer_ids: [...step.reviewer_ids], reviewers: [...step.reviewers] }))
      acceptedRevision.value = current.revision
      baseline.value = snapshot(); error.value = null; attempted.value = false; reloadRequested.value = false
    } catch (e) { error.value = e }
  })
}
</script>
<template>
  <form class="space-y-6" novalidate @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="process?.state === 'published'" color="warning" :title="t('operations.editPublishedNotice')" />
    <SharedFormSection :title="t('operations.processInformation')">
      <div class="grid gap-4"><UFormField name="name" :label="t('operations.name')" required :error="fieldError('name')"><UInput v-model="name" class="w-full" :disabled="disabled" required /></UFormField><UFormField name="description" :label="t('operations.description')" :error="fieldError('description')"><UTextarea v-model="description" class="w-full" :rows="4" :disabled="disabled" /></UFormField><UFormField name="execution_kind" :label="t('operations.result')" :error="fieldError('execution_kind')"><USelect v-model="executionKind" :items="kindItems" class="w-full" :disabled="disabled || kinds.isPending.value || !!kinds.error.value" /></UFormField></div>
    </SharedFormSection>
    <SharedFormSection :title="t('operations.stages')" :description="t('operations.stageOrderHelp')">
      <ol class="space-y-4"><li v-for="(step, index) in steps" :key="index" class="space-y-3 rounded-card bg-default p-4 ring ring-default">
        <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-medium text-highlighted">{{ t('operations.stageNumber', { number: index + 1 }) }}</h3><div class="flex gap-1"><UButton type="button" color="neutral" variant="ghost" square icon="i-lucide-arrow-up" :aria-label="t('operations.moveUp')" :disabled="disabled || index === 0" @click="move(index, -1)" /><UButton type="button" color="neutral" variant="ghost" square icon="i-lucide-arrow-down" :aria-label="t('operations.moveDown')" :disabled="disabled || index === steps.length - 1" @click="move(index, 1)" /><UButton type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="t('operations.removeStage')" :disabled="disabled" @click="steps.splice(index, 1)" /></div></div>
        <UFormField :name="`steps.${index}.name`" :label="t('operations.stageName')" required :error="fieldError(`steps.${index}.name`)"><UInput v-model="step.name" class="w-full" :disabled="disabled" /></UFormField>
        <UFormField :name="`steps.${index}.reviewer_ids`" :label="t('operations.reviewers')" required :error="fieldError(`steps.${index}.reviewer_ids`)"><SharedPersonPicker :model-value="step.reviewer_ids" multiple value-key="user_id" :known="step.reviewers" :disabled="disabled" :aria-label="t('operations.reviewers')" @update:model-value="value => setReviewers(index, value)" /></UFormField>
      </li></ol>
      <p v-if="fieldError('steps')" role="alert" class="text-sm text-error">{{ fieldError('steps') }}</p>
      <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="disabled" :label="t('operations.addStage')" @click="steps.push({ name: '', reviewer_ids: [], reviewers: [] })" />
    </SharedFormSection>
    <UAlert v-if="error || kinds.error.value" role="alert" color="error" variant="subtle" :title="t(`operations.errors.${operationErrorKey(error ?? kinds.error.value)}`)"><template v-if="refresh && operationErrorKey(error) === 'conflict'" #actions><UButton color="neutral" variant="outline" :disabled="disabled" :label="t('operations.refresh')" @click="requestReload" /></template></UAlert>
    <SharedInlineConfirm v-if="reloadRequested" :title="t('operations.reloadDraft')" :description="t('operations.reloadDraftHelp')" :confirm-label="t('operations.refresh')" color="warning" :disabled="disabled" :pending="pending" @confirm="reload" @cancel="reloadRequested = false" />
    <SharedFormActions class="flex flex-wrap justify-end gap-2"><UButton type="button" color="neutral" variant="outline" :to="backTo" :disabled="disabled" :label="t('operations.cancel')" /><UButton type="submit" :disabled="disabled || kinds.isPending.value || !!kinds.error.value" :loading="pending" :label="t(process ? 'operations.save' : 'operations.create')" /></SharedFormActions>
  </form>
</template>
