<script setup lang="ts">
import StateBadge from '@/components/operations/StateBadge.vue'
import { useOperationProcess, useOperationProcessMutation } from '@/composables/operations/useOperations'
import { createOperationSubmitGuard, operationErrorKey, operationId, safeOperationReturnTo } from '@/composables/operations/forms'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const id = computed(() => operationId(route.params.id))
const query = useOperationProcess(id)
const process = query.data
const mutation = useOperationProcessMutation()
const gate = createOperationSubmitGuard()
const pending = gate.pending
const selected = ref<'publish' | 'archive' | null>(null)
const selectedRevision = ref(0)
const error = ref<unknown>(null)
const backTo = computed(() => safeOperationReturnTo(route.query.returnTo, '/operations/processes'))
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
  <SharedPageContainer width="detail">
    <SharedPageHeader :title="process?.name ?? t('operations.process')" :back-to="backTo" :back-label="t('operations.nav.processes')"><template #actions><template v-if="process && can('operations.processes.manage')"><UButton color="neutral" variant="outline" :disabled="disabled" :to="{ path: `/operations/processes/${process.id}/edit`, query: { returnTo: backTo } }" :label="t('operations.edit')" /><UButton v-if="process.state === 'draft'" :disabled="disabled" :label="t('operations.publish')" @click="choose('publish')" /><UButton v-if="process.state !== 'archived'" color="error" variant="outline" :disabled="disabled" :label="t('operations.archive')" @click="choose('archive')" /></template></template></SharedPageHeader>
    <SharedPageState :loading="id !== null && query.isPending.value" :error="id === null ? { status: 404 } : query.error.value" @retry="hydrated && query.refetch()">
      <template v-if="process">
        <StateBadge :state="process.state" />
        <UAlert v-if="error" role="alert" color="error" :title="t(`operations.errors.${operationErrorKey(error)}`)"><template #actions><UButton color="neutral" variant="outline" :disabled="disabled" :label="t('operations.refresh')" @click="refresh" /></template></UAlert>
        <SharedInlineConfirm v-if="selected" :title="t(`operations.confirm.${selected}`)" :description="t(selected === 'archive' ? 'operations.archiveHelp' : 'operations.publishHelp')" :confirm-label="t(`operations.${selected}`)" :color="selected === 'archive' ? 'error' : 'primary'" :pending="pending" :disabled="disabled" @confirm="confirmDecision" @cancel="selected = null" />
        <SharedFormSection :title="t('operations.description')"><p class="whitespace-pre-wrap text-sm leading-7">{{ process.description || t('operations.noDescription') }}</p></SharedFormSection>
        <SharedFormSection :title="t('operations.result')"><p class="text-sm">{{ t(`operations.executionKinds.${process.execution_kind === 'approval' || process.execution_kind === 'pmo_completion' ? process.execution_kind : 'other'}`) }}</p></SharedFormSection>
        <SharedFormSection :title="t('operations.stages')"><ol class="space-y-3"><li v-for="(step, index) in process.steps" :key="index" class="rounded-lg p-4 ring ring-default"><h3 class="font-medium">{{ index + 1 }}. {{ step.name }}</h3><p class="mt-1 text-sm text-muted">{{ step.reviewers.map(person => person.name).join('، ') }}</p></li></ol></SharedFormSection>
      </template>
    </SharedPageState>
  </SharedPageContainer>
</template>
