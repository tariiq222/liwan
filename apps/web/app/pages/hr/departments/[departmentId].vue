<script setup lang="ts">
import DocumentList from '@/components/hr/DocumentList.vue'
import { useHrDepartment } from '@/composables/useHrDepartments'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated(); const id = computed(() => Number(route.params.departmentId)); const isDetail = computed(() => route.path === `/hr/departments/${id.value}`); const query = useHrDepartment(computed(() => isDetail.value ? id.value : null)); const department = computed(() => query.data.value)
// The owning list is fixed by this page's own route, so the return trip is
// literal and carries only the state the list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/hr/departments', query: listQuery }
})
</script>
<template>
  <SharedPageContainer v-if="isDetail" width="detail">
    <SharedPageHeader :title="department?.name || t('hr.depts.title')" :back-to="backTo">
      <UButton v-if="department && can('hr.departments.manage')" color="primary" :disabled="!hydrated" :to="`/hr/departments/${id}/edit`" :label="t('hr.depts.edit')" @click="!hydrated && $event.preventDefault()" />
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!department" @retry="query.refetch">
      <div v-if="department" class="grid gap-6 items-start lg:grid-cols-[2fr_1fr]">
        <UCard v-if="can('hr.documents.read')" class="rounded-lg ring ring-default bg-default overflow-hidden" :ui="{ header: '' }">
          <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('hr.depts.detail') }}</h2></template>
          <DocumentList :department-id="id" :can-write="can('hr.documents.manage')" embedded />
        </UCard>
        <UCard class="rounded-lg ring ring-default bg-default overflow-hidden" :ui="{ header: '' }">
          <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('hr.card.overview') }}</h2></template>
          <dl class="grid gap-4">
            <div><dt class="text-sm text-muted">{{ t('hr.tabs.employees') }}</dt><dd class="mt-1 font-medium">{{ department.employee_count }}</dd></div>
            <div><dt class="text-sm text-muted">{{ t('hr.depts.manager') }}</dt><dd class="mt-1 font-medium">{{ department.manager?.name || t('hr.depts.noManager') }}</dd></div>
          </dl>
        </UCard>
      </div>
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage v-else />
</template>
