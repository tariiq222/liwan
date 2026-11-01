<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import OperationStepRow from '@/components/operations/OperationStepRow.vue'
import { operationsStateTone } from '@/composables/operations/state'
import { statusTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { useOperationExecutionKinds, useOperationProcess, useOperationProcessMutation } from '@/composables/operations/useOperations'
import { createOperationSubmitGuard, executionKindLabel, operationErrorKey, operationId } from '@/composables/operations/forms'
const route = useRoute()
const router = useRouter()
const sourcePaths = useRecordListPaths(['/settings/apps/operations/processes'])
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const id = computed(() => operationId(route.params.id))
const query = useOperationProcess(id)
const kinds = useOperationExecutionKinds()
const process = query.data
const mutation = useOperationProcessMutation()
const gate = createOperationSubmitGuard()
const pending = gate.pending
const headerTags = computed(() => process.value ? [statusTag({ tone: operationsStateTone(process.value.state), label: t(`operations.states.${process.value.state}`) })] : [])
const selected = ref<'publish' | 'archive' | null>(null)
const selectedRevision = ref(0)
const error = ref<unknown>(null)
const backTo = computed(() => router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath)
const disabled = computed(() => !hydrated.value || pending.value)
function choose(action: 'publish' | 'archive') { if (disabled.value || !process.value || !can('operations.processes.manage')) return; selected.value = action; selectedRevision.value = process.value.revision; error.value = null }
async function confirmDecision() {
  if (disabled.value || !process.value || !selected.value || !can('operations.processes.manage')) return
  const action = selected.value
  await gate.run(async () => { try { await mutation.mutateAsync({ action, id: process.value!.id, body: { revision: selectedRevision.value } }); selected.value = null; error.value = null } catch (e) { error.value = e } })
}
async function refresh() { if (disabled.value) return; selected.value = null; error.value = null; await query.refetch() }
</script>
<template>
  <SharedRecordPage
    :title="process?.name ?? t('operations.process')"
    :tags="headerTags"
    :back-to="backTo"
    :back-label="t('operations.nav.processes')"
    :loading="id !== null && query.isPending.value"
    :error="id === null ? { status: 404 } : query.error.value"
    @retry="hydrated && query.refetch()"
  >
    <template v-if="process && can('operations.processes.manage')" #actions>
      <UButton v-if="process.state !== 'archived'" color="neutral" variant="outline" :disabled="disabled" :to="recordChildTo(`/settings/apps/operations/processes/${process.id}/edit`, route.query, sourcePaths, route.hash)" :label="t('operations.edit')" />
      <UButton v-if="process.state === 'draft'" :disabled="disabled" :label="t('operations.publish')" @click="choose('publish')" />
      <UButton v-if="process.state !== 'archived'" color="error" variant="outline" :disabled="disabled" :label="t('operations.archive')" @click="choose('archive')" />
    </template>
    <template v-if="process">
      <UAlert v-if="error" role="alert" color="error" :title="t(`operations.errors.${operationErrorKey(error)}`)"><template #actions><UButton color="neutral" variant="outline" :disabled="disabled" :label="t('operations.refresh')" @click="refresh" /></template></UAlert>
      <SharedInlineConfirm v-if="selected" :title="t(`operations.confirm.${selected}`)" :description="t(selected === 'archive' ? 'operations.archiveHelp' : 'operations.publishHelp')" :confirm-label="t(`operations.${selected}`)" :color="selected === 'archive' ? 'error' : 'primary'" :pending="pending" :disabled="disabled" @confirm="confirmDecision" @cancel="selected = null" />
      <SharedRecordSection variant="panel" :title="t('operations.description')"><p class="whitespace-pre-wrap text-sm leading-7">{{ process.description || t('operations.noDescription') }}</p></SharedRecordSection>
      <SharedRecordSection variant="panel" :title="t('operations.stages')">
        <ol class="space-y-3"><OperationStepRow v-for="(step, index) in process.steps" :key="index" :number="index + 1" :name="step.name" :reviewers="step.reviewers" :resolver-label="step.resolver_label" :ineligible="step.reviewers.filter(person => step.ineligible_reviewer_ids.includes(person.user_id))" /></ol>
      </SharedRecordSection>
    </template>
    <template v-if="process" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('operations.result')" :value="executionKindLabel(kinds.data.value?.items, process.execution_kind)" />
        <SharedPropertyRow :label="t('operations.stages')" :value="t('operations.stageCount', { count: process.steps.length }, process.steps.length)" />
        <SharedPropertyRow :label="t('operations.stageApprovalMode')" :value="t(`operations.stageApprovalModes.${process.stage_approval_mode}`)" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
