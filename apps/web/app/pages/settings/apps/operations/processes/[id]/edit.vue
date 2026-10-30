<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import ProcessForm from '@/components/operations/ProcessForm.vue'
import { useOperationProcess, useOperationProcessMutation } from '@/composables/operations/useOperations'
import { operationId } from '@/composables/operations/forms'
import type { OperationProcessBody } from '@liwan/contracts'
const route = useRoute()
const router = useRouter()
const sourcePaths = useRecordListPaths(['/settings/apps/operations/processes'])
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const id = computed(() => operationId(route.params.id))
const process = useOperationProcess(id)
const mutation = useOperationProcessMutation()
const backTo = computed(() => router.resolve(recordParentTo(`/settings/apps/operations/processes/${id.value}`, route.query, sourcePaths.value, route.hash)).fullPath)
function save(body: OperationProcessBody) { return mutation.mutateAsync({ action: 'edit', id: id.value!, body }) }
async function refresh() { const response = await process.refetch(); if (response.error) throw response.error; return response.data! }

</script>
<template><SharedPageContainer width="form"><SharedPageHeader :title="t('operations.editProcess')" :back-to="backTo" :back-label="t('operations.process')" /><SharedPageState :loading="id !== null && process.isPending.value" :error="id === null ? { status: 404 } : process.error.value" @retry="hydrated && process.refetch()"><UAlert v-if="process.data.value?.state === 'archived'" color="warning" :title="t('operations.archivedNotEditable')" /><ProcessForm v-else-if="can('operations.processes.manage') && process.data.value" :key="process.data.value.id" :process="process.data.value" :back-to="backTo" :save="save" :refresh="refresh" @saved="navigateTo(backTo)" /><UAlert v-else color="error" :title="t('operations.errors.forbidden')" /></SharedPageState></SharedPageContainer></template>
