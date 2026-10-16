<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import RequestList from '@/components/operations/RequestList.vue'
import RequestForm, { type RequestFormPayload } from '@/components/operations/RequestForm.vue'
import { useOperationProcesses, useOperationRequestMutation } from '@/composables/operations/useOperations'
const route = useRoute()
const router = useRouter()
const sourcePaths = useRecordListPaths(['/operations', '/operations/pending', '/operations/monitoring', '/operations/processes'])
const { t } = useI18n()
const { can } = useAccess()
const backTo = computed(() => router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath)
const backgroundScope = computed(() => backTo.value.startsWith('/operations/pending') ? 'pending' : backTo.value.startsWith('/operations/monitoring') ? 'monitoring' : 'mine')
const processes = useOperationProcesses({ published: 1, limit: 200 }, computed(() => can('operations.requests.create')))
const mutation = useOperationRequestMutation()
async function save(body: RequestFormPayload) {
  return mutation.mutateAsync({ action: 'create', body: { name: body.name, description: body.description, process_id: body.process_id!, ...(body.target_id ? { target_id: body.target_id } : {}) } })
}
</script>
<template>
  <SharedPageContainer width="list"><RequestList :scope="backgroundScope" background /></SharedPageContainer>
  <SharedCreatePanel :title="t('operations.newRequest')" :back-to="backTo">
    <RequestForm v-if="can('operations.requests.create')" :processes="processes.data.value?.items ?? []" :loading="processes.isPending.value" :process-error="processes.error.value" :back-to="backTo" :save="save" @saved="record => navigateTo({ path: `/operations/${record.id}`, query: { returnTo: backTo } }, { replace: true })" />
    <UAlert v-else color="error" :title="t('operations.errors.forbidden')" />
  </SharedCreatePanel>
</template>
