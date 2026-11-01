<script setup lang="ts">
import WarningForm from '@/components/hr/warnings/WarningForm.vue'
import { owningListBack } from '@/utils/recordListOrigin'
import type { HrWarning } from '@/composables/useHrWarnings'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/warnings'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const canManage = computed(() => can('hr.warnings.manage'))
const types = useHrWarningTypes('true')
const employees = useHrEmployees(computed(() => ({ limit: 100 })))

function saved(warning: HrWarning) {
  void navigateTo({
    path: `/hr/warnings/${warning.id}`,
    query: { returnTo: router.resolve(backTo.value).fullPath },
  }, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t('hrWarnings.new')" :back-to="backTo">
    <SharedForbiddenState v-if="!canManage" />
    <SharedPageState v-else :loading="types.isLoading.value || employees.isLoading.value" :error="types.error.value ?? employees.error.value" @retry="types.refetch(); employees.refetch()">
      <WarningForm
        :employees="(employees.data.value?.items ?? []).map(employee => ({ id: employee.id, name: employee.name }))"
        :types="types.data.value?.items ?? []"
        :back-to="backTo"
        @saved="saved"
      />
    </SharedPageState>
  </SharedCreatePanel>
</template>
