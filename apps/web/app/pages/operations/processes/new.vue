<script setup lang="ts">
import ProcessList from '@/components/operations/ProcessList.vue'
import ProcessForm from '@/components/operations/ProcessForm.vue'
import { useOperationProcessMutation } from '@/composables/operations/useOperations'
import { operationListLocation, safeOperationReturnTo } from '@/composables/operations/forms'
import type { OperationProcessBody } from '@nasq/contracts'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const backTo = computed(() => safeOperationReturnTo(route.query.returnTo, operationListLocation('/operations/processes', route.query, route.hash)))
const mutation = useOperationProcessMutation()
function save(body: OperationProcessBody) { return mutation.mutateAsync({ action: 'create', body }) }
</script>
<template>
  <SharedPageContainer width="list"><ProcessList background /></SharedPageContainer>
  <SharedCreatePanel :title="t('operations.newProcess')" :back-to="backTo">
    <ProcessForm v-if="can('operations.processes.manage')" :back-to="backTo" :save="save" @saved="process => navigateTo({ path: `/operations/processes/${process.id}`, query: { returnTo: backTo } })" />
    <UAlert v-else color="error" :title="t('operations.errors.forbidden')" />
  </SharedCreatePanel>
</template>
