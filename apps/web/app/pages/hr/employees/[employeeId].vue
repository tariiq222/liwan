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
  <div v-if="isDetail" class="mx-auto w-full max-w-5xl space-y-8"><SharedPageHeader :title="query.data.value?.name || t('hr.employee.title')" :back-to="returnTo">
    <div class="flex flex-wrap gap-2">
      <NuxtLink v-if="query.data.value && can('hr.employees.manage')" :to="{ path: `/hr/employees/${id}/edit`, query: returnToQuery(route.fullPath) }" @click="!hydrated && $event.preventDefault()"><Button :disabled="!hydrated">{{ t('app.edit') }}</Button></NuxtLink>
      <NuxtLink v-if="query.data.value?.user_id && can('access.users.read')" :to="{ path: `/settings/users/${query.data.value.user_id}`, query: returnToQuery(route.fullPath) }" @click="!hydrated && $event.preventDefault()"><Button variant="outline" :disabled="!hydrated">{{ t('hr.employee.manageAccount') }}</Button></NuxtLink>
      <Button v-if="query.data.value && can('hr.employees.archive')" variant="outline" :disabled="!hydrated || archivePending" @click="confirmArchive = !confirmArchive">{{ query.data.value.active ? t('hr.employee.archive') : t('hr.employee.unarchive') }}</Button>
    </div>
  </SharedPageHeader><SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value" @retry="query.refetch" /><div v-if="query.data.value && confirmArchive" class="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm"><p>{{ t('hr.employee.archiveConfirm') }}</p><div class="mt-3 flex gap-2"><Button :disabled="!hydrated || archivePending" @click="toggleArchive">{{ query.data.value.active ? t('hr.employee.archive') : t('hr.employee.unarchive') }}</Button><Button variant="outline" :disabled="archivePending" @click="confirmArchive = false">{{ t('app.cancel') }}</Button></div></div><EmployeeCard v-if="query.data.value" :employee-id="id" /></div><NuxtPage v-else />
</template>
