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
      <div class="flex flex-wrap gap-2">
        <Button v-if="query.data.value && can('hr.employees.manage')" as-child :disabled="!hydrated"><NuxtLink :to="{ path: `/hr/employees/${id}/edit`, query: returnToQuery(route.fullPath) }" @click="!hydrated && $event.preventDefault()">{{ t('app.edit') }}</NuxtLink></Button>
        <Button v-if="query.data.value?.user_id && can('access.users.read')" as-child variant="outline" :disabled="!hydrated"><NuxtLink :to="{ path: `/settings/users/${query.data.value.user_id}`, query: returnToQuery(route.fullPath) }" @click="!hydrated && $event.preventDefault()">{{ t('hr.employee.manageAccount') }}</NuxtLink></Button>
        <Button v-if="query.data.value && can('hr.employees.archive')" variant="outline" :disabled="!hydrated || archivePending" @click="confirmArchive = !confirmArchive">{{ query.data.value.active ? t('hr.employee.archive') : t('hr.employee.unarchive') }}</Button>
      </div>
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value" @retry="query.refetch">
      <div v-if="confirmArchive" class="nasq-status-callout-danger p-4 text-sm">
        <p>{{ t('hr.employee.archiveConfirm') }}</p>
        <div class="mt-3 flex gap-2">
          <Button :disabled="!hydrated || archivePending" @click="toggleArchive">{{ query.data.value?.active ? t('hr.employee.archive') : t('hr.employee.unarchive') }}</Button>
          <Button variant="outline" :disabled="archivePending" @click="confirmArchive = false">{{ t('app.cancel') }}</Button>
        </div>
      </div>
      <EmployeeCard :employee-id="id" />
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage v-else />
</template>
