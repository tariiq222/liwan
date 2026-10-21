<script setup lang="ts">
import PayrollRunCreateForm from '@/components/hr/payroll/PayrollRunCreateForm.vue'
import { owningListBack } from '@/utils/recordListOrigin'
import type { HrPayrollRun } from '@webvue/contracts'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/payroll'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const canManage = computed(() => can('hr.payroll.manage'))

function saved(run: HrPayrollRun) {
  void navigateTo({ path: `/hr/payroll/${run.id}`, query: { returnTo: router.resolve(backTo.value).fullPath } }, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t('hrPayroll.runs.new')" :back-to="backTo">
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <PayrollRunCreateForm v-else :back-to="backTo" @saved="saved" />
  </SharedCreatePanel>
</template>
