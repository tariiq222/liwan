<script setup lang="ts">
import EmployeeCard from '@/components/hr/EmployeeCard.vue'
import { useArchiveHrEmployee, useHrEmployee, useUnarchiveHrEmployee } from '@/composables/useHrEmployees'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated()
const id = computed(() => Number(route.params.employeeId)); const isDetail = computed(() => route.path === `/hr/employees/${id.value}`); const query = useHrEmployee(computed(() => isDetail.value ? id.value : null))
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/hr', ['/hr']))
const confirmArchive = ref(false)
const { mutateAsync: archive, isPending: archiving } = useArchiveHrEmployee()
const { mutateAsync: unarchive, isPending: unarchiving } = useUnarchiveHrEmployee()
const archivePending = computed(() => archiving.value || unarchiving.value)
async function toggleArchive() {
  if (!query.data.value || !hydrated.value) return
  if (query.data.value.active) await archive(query.data.value.id)
  else await unarchive(query.data.value.id)
  confirmArchive.value = false
}
</script>
<template>
  <SharedPageContainer v-if="isDetail" width="detail">
    <SharedPageHeader :title="query.data.value?.name || t('hr.employee.title')" :description="query.data.value?.job_title" :back-to="returnTo">
      <div class="flex flex-wrap items-center gap-2">
        <UButton v-if="query.data.value && can('hr.employees.manage')" color="primary" :disabled="!hydrated" :to="{ path: `/hr/employees/${id}/edit`, query: returnToQuery(route.fullPath) }" :label="t('app.edit')" @click="!hydrated && $event.preventDefault()" />
        <UButton v-if="query.data.value?.user_id && can('access.users.read')" color="secondary" variant="outline" :disabled="!hydrated" :to="{ path: `/settings/users/${query.data.value.user_id}`, query: returnToQuery(route.fullPath) }" :label="t('hr.employee.manageAccount')" @click="!hydrated && $event.preventDefault()" />
        <UButton v-if="query.data.value && can('hr.employees.archive')" color="error" variant="outline" :disabled="!hydrated || archivePending" :label="query.data.value.active ? t('hr.employee.archive') : t('hr.employee.unarchive')" @click="confirmArchive = !confirmArchive" />
      </div>
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value" @retry="query.refetch">
      <UAlert v-if="confirmArchive" role="alert" color="error" variant="subtle" :title="t('hr.employee.archiveConfirm')">
        <template #actions>
          <UButton color="error" :disabled="!hydrated || archivePending" :label="query.data.value?.active ? t('hr.employee.archive') : t('hr.employee.unarchive')" @click="toggleArchive" />
          <UButton color="neutral" variant="outline" :disabled="archivePending" :label="t('app.cancel')" @click="confirmArchive = false" />
        </template>
      </UAlert>
      <EmployeeCard :employee-id="id" />
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage v-else />
</template>
