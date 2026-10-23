<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import RequestList from '@/components/operations/RequestList.vue'
import RequestForm, { type RequestFormPayload } from '@/components/operations/RequestForm.vue'
import { useOperationProcesses, useOperationRequestMutation } from '@/composables/operations/useOperations'
const props = defineProps<{ personal?: boolean }>()
const basePath = computed(() => props.personal ? '/account/requests' : '/operations')
const route = useRoute()
const router = useRouter()
const sourcePaths = useRecordListPaths(() => props.personal ? ['/account/requests', '/account'] : ['/operations', '/operations/pending', '/operations/monitoring'])
const { t } = useI18n()
const { can } = useAccess()
const backTo = computed(() => router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath)
const backgroundScope = computed(() => backTo.value.startsWith('/operations/pending') ? 'pending' : backTo.value.startsWith('/operations/monitoring') ? 'monitoring' : 'mine')
const processes = useOperationProcesses(() => ({ published: 1, purpose: props.personal ? 'employee' : 'work', limit: 200 }), computed(() => can('operations.requests.create')))
const mutation = useOperationRequestMutation()
async function save(body: RequestFormPayload) {
  return mutation.mutateAsync({ action: 'create', body: { name: body.name, description: body.description, process_id: body.process_id!, ...(body.target_id ? { target_id: body.target_id } : {}) } })
}
</script>
<template>
  <SharedListPage :title="t(personal ? 'operations.personal.title' : `operations.nav.${backgroundScope}`)" hide-header><RequestList :scope="backgroundScope" :personal="personal" background /></SharedListPage>
  <SharedCreatePanel :title="t(personal ? 'operations.personal.new' : 'operations.newRequest')" :back-to="backTo">
    <RequestForm v-if="can('operations.requests.create')" :processes="processes.data.value?.items ?? []" :loading="processes.isPending.value" :process-error="processes.error.value" :back-to="backTo" :save="save" @saved="record => navigateTo({ path: `${basePath}/${record.id}`, query: { returnTo: backTo } }, { replace: true })" />
    <SharedForbiddenState v-else :description="t('operations.errors.forbidden')" />
  </SharedCreatePanel>
</template>
