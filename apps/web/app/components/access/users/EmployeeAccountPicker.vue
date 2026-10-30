<script setup lang="ts">
import { useEmployeeAccountCandidates, type EmployeeAccountCandidateParams } from '@/composables/useEmployeeAccounts'
import type { EmployeeAccountCandidate } from '@liwan/contracts'

// The employee choice of the account form (the employee-account bridge): a search, one select over the current
// page of candidates and the pager. An employee with an active account cannot be chosen; a stopped one is
// offered for reactivation. The chosen candidate is reported with the id so the form can tell the two apart.
const props = defineProps<{
  /** The employee opened from an employee page: the search stays fixed on that one employee. */
  requestedEmployeeId?: number
}>()
const employeeId = defineModel<number | undefined>({ required: true })
const candidate = defineModel<EmployeeAccountCandidate | undefined>('candidate')
const { t } = useI18n()
const hydrated = useHydrated()
const params = reactive<Required<Pick<EmployeeAccountCandidateParams, 'q' | 'status' | 'limit' | 'offset'>> & Pick<EmployeeAccountCandidateParams, 'employee_id'>>({ q: '', status: 'active', employee_id: props.requestedEmployeeId, limit: 25, offset: 0 })
const employees = useEmployeeAccountCandidates(params)
const page = computed(() => Math.floor(params.offset / params.limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil((employees.data.value?.total ?? 0) / params.limit)))
const hasActiveAccount = (employee: EmployeeAccountCandidate) => employee.user_id !== null && employee.access_active !== false
const options = computed(() => (employees.data.value?.items ?? []).map((employee) => ({
  value: String(employee.id),
  label: `${employee.name}${employee.work_email ? ` — ${employee.work_email}` : ''}${employee.user_id && employee.access_active === false ? ` — ${t('access.users.stoppedAccount')}` : ''}`,
  disabled: hasActiveAccount(employee),
})))
watch(() => params.q, () => { params.offset = 0 })
watch([() => employees.data.value, employeeId], () => {
  candidate.value = employees.data.value?.items.find((item) => item.id === employeeId.value)
}, { immediate: true })
function setPage(next: number) {
  if (!hydrated.value || next < 1 || next > pages.value) return
  params.offset = (next - 1) * params.limit
}
</script>

<template>
  <div class="grid gap-4">
    <UFormField :label="t('access.users.employee')" name="employee-search">
      <UInput id="employee-search" v-model="params.q" class="w-full" :placeholder="t('access.users.filters.search')" :disabled="!hydrated || props.requestedEmployeeId !== undefined" icon="i-lucide-search" />
    </UFormField>
    <USelect
      id="employee"
      :model-value="employeeId ? String(employeeId) : undefined"
      :items="options"
      class="w-full"
      :aria-label="t('access.users.chooseEmployee')"
      :placeholder="t('access.users.chooseEmployee')"
      :disabled="!hydrated || employees.isLoading.value"
      @update:model-value="(value: unknown) => { employeeId = value ? Number(value) : undefined }"
    />
    <p v-if="employees.isLoading.value" class="text-sm text-muted">{{ t('access.users.loadingCandidates') }}</p>
    <UAlert v-else-if="employees.error.value" color="error" variant="subtle" :title="t('errors.generic')" />
    <UAlert v-if="candidate && hasActiveAccount(candidate)" color="error" variant="subtle" :title="t('access.users.alreadyHasAccount')" />
    <SharedPagination :page="page" :pages="pages" :disabled="employees.isFetching.value" @update:page="setPage" />
  </div>
</template>
