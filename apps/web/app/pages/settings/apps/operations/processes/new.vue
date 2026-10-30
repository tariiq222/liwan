<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import ProcessList from '@/components/operations/ProcessList.vue'
import ProcessForm from '@/components/operations/ProcessForm.vue'
import { useOperationProcessMutation } from '@/composables/operations/useOperations'
import type { OperationProcessBody } from '@liwan/contracts'
const route = useRoute()
const router = useRouter()
const sourcePaths = useRecordListPaths(['/settings/apps/operations/processes'])
const { t } = useI18n()
const { can } = useAccess()
const backTo = computed(() => router.resolve(owningListBack(route.query, sourcePaths.value, route.hash)).fullPath)
const mutation = useOperationProcessMutation()
function save(body: OperationProcessBody) { return mutation.mutateAsync({ action: 'create', body }) }
</script>
<template>
  <SharedListPage :title="t('operations.nav.processes')" hide-header><ProcessList background /></SharedListPage>
  <SharedCreatePanel :title="t('operations.newProcess')" :back-to="backTo">
    <ProcessForm v-if="can('operations.processes.manage')" :back-to="backTo" :save="save" @saved="process => navigateTo({ path: `/settings/apps/operations/processes/${process.id}`, query: { returnTo: backTo } }, { replace: true })" />
    <SharedForbiddenState v-else :description="t('operations.errors.forbidden')" />
  </SharedCreatePanel>
</template>
