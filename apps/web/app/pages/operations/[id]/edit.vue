<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import RequestForm, { type RequestFormPayload } from '@/components/operations/RequestForm.vue'
import { useOperationRequest, useOperationRequestMutation } from '@/composables/operations/useOperations'
import { operationId } from '@/composables/operations/forms'
const route = useRoute()
const router = useRouter()
const sourcePaths = useRecordListPaths(['/operations', '/operations/pending', '/operations/monitoring'])
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => operationId(route.params.id))
const record = useOperationRequest(id)
const mutation = useOperationRequestMutation()
const backTo = computed(() => router.resolve(recordParentTo(`/operations/${id.value}`, route.query, sourcePaths.value, route.hash)).fullPath)
async function save(body: RequestFormPayload) { return mutation.mutateAsync({ action: 'edit', id: id.value!, body: { name: body.name, description: body.description, revision: body.revision! } }) }
async function refresh() { const response = await record.refetch(); if (response.error) throw response.error; return response.data! }

</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('operations.editRequest')" :back-to="backTo" :back-label="t('operations.request')" />
    <SharedPageState :loading="id !== null && record.isPending.value" :error="id === null ? { status: 404 } : record.error.value" @retry="hydrated && record.refetch()">
      <RequestForm v-if="record.data.value?.allowed_actions.edit" :key="record.data.value.id" :record="record.data.value" :back-to="backTo" :save="save" :refresh="refresh" @saved="navigateTo(backTo)" />
      <UAlert v-else color="warning" :title="t('operations.notEditable')" />
    </SharedPageState>
  </SharedPageContainer>
</template>
