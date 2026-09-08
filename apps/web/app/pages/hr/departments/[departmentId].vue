<script setup lang="ts">
import DocumentList from '@/components/hr/DocumentList.vue'
import { useHrDepartment } from '@/composables/useHrDepartments'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const id = computed(() => Number(route.params.departmentId)); const isDetail = computed(() => route.path === `/hr/departments/${id.value}`); const query = useHrDepartment(computed(() => isDetail.value ? id.value : null)); const department = computed(() => query.data.value); const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/hr/departments', ['/hr']))
</script>
<template>
  <SharedPageContainer v-if="isDetail" width="detail">
    <SharedPageHeader :title="department?.name || t('hr.depts.title')" :back-to="returnTo">
      <NuxtLink v-if="department && can('hr.departments.manage')" :to="{ path: `/hr/departments/${id}/edit`, query: returnToQuery(route.fullPath) }"><Button>{{ t('hr.depts.edit') }}</Button></NuxtLink>
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!department" @retry="query.refetch">
      <div v-if="department" class="nasq-detail-grid">
        <DocumentList v-if="can('hr.documents.read')" :department-id="id" :can-write="can('hr.documents.manage')" />
        <aside class="nasq-panel nasq-panel-body">
          <dl class="nasq-metadata">
            <div><dt>{{ t('hr.depts.employeeReason', { count: department.employee_count }) }}</dt><dd>{{ department.employee_count }}</dd></div>
            <div><dt>{{ t('hr.depts.manager') }}</dt><dd>{{ department.manager?.name || t('hr.depts.noManager') }}</dd></div>
          </dl>
        </aside>
      </div>
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage v-else />
</template>
