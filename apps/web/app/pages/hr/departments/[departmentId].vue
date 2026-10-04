<script setup lang="ts">
import { hrDepartmentBack, hrDepartmentContext } from '@/utils/hrReturnTo'
import DocumentList from '@/components/hr/DocumentList.vue'
import { useHrDepartment } from '@/composables/useHrDepartments'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated(); const id = computed(() => Number(route.params.departmentId)); const isCreateDocument = computed(() => route.path === `/hr/departments/${id.value}/documents/new`); const isDetail = computed(() => route.path === `/hr/departments/${id.value}` || isCreateDocument.value); const query = useHrDepartment(computed(() => isDetail.value ? id.value : null)); const department = computed(() => query.data.value)
const backTo = computed(() => hrDepartmentBack(route.query, route.hash))
const editTo = computed(() => ({ path: `/hr/departments/${id.value}/edit`, query: hrDepartmentContext(route.query), ...(route.hash ? { hash: route.hash } : {}) }))
</script>
<template>
  <SharedPageContainer v-if="isDetail" width="detail">
    <!-- Under the create-document panel the registered (shell) title stays static so the
         loaded department name never overwrites the panel's title; the visible heading keeps the name. -->
    <SharedPageHeader :title="isCreateDocument ? t('hr.depts.title') : (department?.name || t('hr.depts.title'))" :back-to="isCreateDocument ? undefined : backTo">
      <template #title>{{ department?.name || t('hr.depts.title') }}</template>
      <UButton v-if="department && can('hr.departments.manage')" color="primary" :disabled="!hydrated" :to="editTo" :label="t('hr.depts.edit')" @click="!hydrated && $event.preventDefault()" />
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
  <NuxtPage />
</template>
