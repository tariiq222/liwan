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
const processes = useOperationProcesses(() => ({ published: 1, requestable: 1, purpose: props.personal ? 'employee' : 'work', limit: 200 }), computed(() => can('operations.requests.create')))
const mutation = useOperationRequestMutation()
// The draft this form already created. A second press of «إنشاء وإرسال» after a refused submit reused to create another
// request; the draft id lets the retry send the same one instead.
let draft: { id: number, revision: number } | null = null
async function save(body: RequestFormPayload, options?: { submitAfter?: boolean }) {
  const record = draft
    ? await mutation.mutateAsync({ action: 'edit', id: draft.id, body: { name: body.name, description: body.description, revision: draft.revision } })
    : await mutation.mutateAsync({ action: 'create', body: { name: body.name, description: body.description, process_id: body.process_id!, ...(body.target_id ? { target_id: body.target_id } : {}) } })
  draft = { id: record.id, revision: record.revision }
  // «إنشاء وإرسال» sends the draft it just made, so the request reaches its approver without a second visit.
  if (options?.submitAfter && record.allowed_actions.submit) {
    return mutation.mutateAsync({ action: 'submit', id: record.id, body: { revision: record.revision } })
  }
  return record
}
</script>
<template>
  <SharedListPage :title="t(personal ? 'operations.personal.title' : `operations.nav.${backgroundScope}`)" hide-header><RequestList :scope="backgroundScope" :personal="personal" background /></SharedListPage>
  <SharedCreatePanel :title="t(personal ? 'operations.personal.new' : 'operations.newRequest')" :back-to="backTo">
    <RequestForm v-if="can('operations.requests.create')" :processes="processes.data.value?.items ?? []" :loading="processes.isPending.value" :process-error="processes.error.value" :back-to="backTo" :save="save" @saved="record => navigateTo({ path: `${basePath}/${record.id}`, query: { returnTo: backTo } }, { replace: true })" />
    <SharedForbiddenState v-else :description="t('operations.errors.forbidden')" />
  </SharedCreatePanel>
</template>
