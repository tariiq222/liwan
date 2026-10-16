<script setup lang="ts">
import type { OperationProcess, OperationRequest } from '@webvue/contracts'
import { refDebounced } from '@vueuse/core'
import { createOperationSubmitGuard, operationErrorKey, requestFormErrors } from '@/composables/operations/forms'
import { useOperationTargets } from '@/composables/operations/useOperations'

export interface RequestFormPayload { name: string; description: string; process_id?: number; target_id?: number; revision?: number }
const props = withDefaults(defineProps<{
  record?: OperationRequest
  processes?: OperationProcess[]
  loading?: boolean
  processError?: unknown
  disabled?: boolean
  backTo: string
  refresh?: () => Promise<OperationRequest>
  save: (body: RequestFormPayload) => Promise<OperationRequest>
}>(), { processes: () => [] })
const emit = defineEmits<{ saved: [record: OperationRequest] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const name = ref(props.record?.name ?? '')
const description = ref(props.record?.description ?? '')
const processId = ref<number | undefined>(props.record?.process.id)
const targetId = ref<number | undefined>()
const targetSearch = ref('')
const targetQuery = refDebounced(targetSearch, 300)
const acceptedRevision = ref(props.record?.revision)
const attempted = ref(false)
const error = ref<unknown>(null)
const reloadRequested = ref(false)
const gate = createOperationSubmitGuard()
const pending = gate.pending
const selectedProcess = computed(() => props.processes.find(process => process.id === processId.value))
const needsTarget = computed(() => !props.record && !!selectedProcess.value && selectedProcess.value.execution_kind !== 'approval')
const targets = useOperationTargets(computed(() => processId.value ?? null), needsTarget, targetQuery)
watch(processId, () => { targetId.value = undefined; targetSearch.value = '' }, { flush: 'sync' })
watch(targetSearch, () => { targetId.value = undefined }, { flush: 'sync' })
function snapshot() { return JSON.stringify([name.value, description.value, processId.value, targetId.value]) }
const baseline = ref(snapshot())
const dirty = computed(() => snapshot() !== baseline.value)
const formErrors = computed(() => {
  const errors = requestFormErrors({ name: name.value, process_id: processId.value ?? null }, !!props.record)
  if (!props.record && processId.value && !selectedProcess.value) errors.process_id = 'unavailableProcess'
  if (needsTarget.value && (!targetId.value || !targets.data.value?.items.some(target => target.id === targetId.value))) errors.target_id = 'required'
  return errors
})
function fieldError(field: string) {
  const client = attempted.value ? formErrors.value[field] : undefined
  const server = error.value as { field?: string; message?: string } | null
  return client ? t(`operations.errors.${client}`) : server?.field === field ? server.message : undefined
}
const processDisabled = computed(() => !hydrated.value || pending.value || props.disabled || props.loading || !!props.processError)
const blocked = computed(() => processDisabled.value || (needsTarget.value && (targetSearch.value !== targetQuery.value || targets.isPending.value || !!targets.error.value)))
async function submit() {
  if (blocked.value) return
  attempted.value = true
  if (Object.keys(formErrors.value).length) return
  await gate.run(async () => {
    error.value = null
    try {
      const body: RequestFormPayload = { name: name.value.trim(), description: description.value }
      if (props.record) body.revision = acceptedRevision.value
      else { body.process_id = processId.value; if (needsTarget.value) body.target_id = targetId.value }
      const record = await props.save(body)
      acceptedRevision.value = record.revision
      baseline.value = snapshot()
      await nextTick()
      emit('saved', record)
    } catch (e) { error.value = e }
  })
}
async function requestReload() {
  if (dirty.value) reloadRequested.value = true
  else await reload()
}
async function reload() {
  if (!hydrated.value || pending.value || !props.refresh) return
  await gate.run(async () => {
    try {
      const current = await props.refresh!()
      name.value = current.name; description.value = current.description; processId.value = current.process.id
      acceptedRevision.value = current.revision
      baseline.value = snapshot(); error.value = null; attempted.value = false; reloadRequested.value = false
    } catch (e) { error.value = e }
  })
}
</script>
<template>
  <form class="space-y-6" novalidate @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection :title="t('operations.requestInformation')">
      <div class="grid gap-4">
        <UFormField name="name" :label="t('operations.name')" required :error="fieldError('name')"><UInput v-model="name" class="w-full" :disabled="!hydrated || pending || disabled" required /></UFormField>
        <UFormField v-if="!record" name="process_id" :label="t('operations.process')" required :error="fieldError('process_id')"><USelect v-model="processId" :items="processes.map(process => ({ label: process.name, value: process.id }))" :placeholder="t('operations.chooseProcess')" class="w-full" :disabled="processDisabled" /></UFormField>
        <p v-else class="text-sm text-muted">{{ t('operations.process') }}: {{ record.process.name }}</p>
        <UFormField v-if="needsTarget" name="target_search" :label="t('operations.searchTargets')"><UInput v-model="targetSearch" type="search" class="w-full" :disabled="processDisabled" /></UFormField>
        <UFormField v-if="needsTarget" name="target_id" :label="t('operations.target')" required :error="fieldError('target_id')"><USelect v-model="targetId" :items="(targets.data.value?.items ?? []).map(target => ({ label: target.name, value: target.id }))" :placeholder="t('operations.chooseTarget')" class="w-full" :disabled="blocked" /></UFormField>
        <UAlert v-if="needsTarget && !targets.isPending.value && !targets.error.value && !targets.data.value?.items.length" color="warning" :title="t('operations.noTargets')" />
        <UFormField name="description" :label="t('operations.description')" :error="fieldError('description')"><UTextarea v-model="description" :rows="5" class="w-full" :disabled="!hydrated || pending || disabled" /></UFormField>
      </div>
    </SharedFormSection>
    <UAlert v-if="processError || (needsTarget && targets.error.value) || error" role="alert" color="error" variant="subtle" :title="t(`operations.errors.${operationErrorKey(error ?? processError ?? targets.error.value)}`)"><template v-if="refresh && operationErrorKey(error) === 'conflict'" #actions><UButton color="neutral" variant="outline" :disabled="!hydrated || pending" :label="t('operations.refresh')" @click="requestReload" /></template></UAlert>
    <SharedInlineConfirm v-if="reloadRequested" :title="t('operations.reloadDraft')" :description="t('operations.reloadDraftHelp')" :confirm-label="t('operations.refresh')" color="warning" :disabled="!hydrated || pending" :pending="pending" @confirm="reload" @cancel="reloadRequested = false" />
    <UAlert v-else-if="!record && !loading && !processes.length" color="warning" :title="t('operations.noPublishedProcesses')" />
    <SharedFormActions class="flex flex-wrap justify-end gap-2"><UButton type="button" color="neutral" variant="outline" :to="backTo" :disabled="!hydrated || pending" :label="t('operations.cancel')" /><UButton type="submit" :disabled="blocked" :loading="pending" :label="t(record ? 'operations.save' : 'operations.create')" /></SharedFormActions>
  </form>
</template>
