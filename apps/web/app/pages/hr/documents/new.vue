<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import DocumentCreateForm from '@/components/hr/DocumentCreateForm.vue'
import { returnToQuery } from '@nasq/ui/app/utils/safeReturnTo'
import { useHrDepartments } from '@/composables/useHrDepartments'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const departments = useHrDepartments()
const canManage = computed(() => can('hr.documents.manage'))
const departmentId = ref(typeof route.query.department_id === 'string' ? Number(route.query.department_id) : 0)
const departmentOptions = computed(() => (departments.data.value?.items ?? []).map(department => ({ value: String(department.id), label: department.name })))
const selectedDepartment = computed(() => departments.data.value?.items.find(d => d.id === departmentId.value))
const sourcePaths = useRecordListPaths(['/hr/documents'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))

function selectDepartment(value: unknown) {
  departmentId.value = value ? Number(value) : 0
}
function saved(id: number) {
  void navigateTo({ path: `/hr/departments/${departmentId.value}/documents/${id}`, query: returnToQuery(router.resolve(backTo.value).fullPath) })
}
</script>

<template>
  <SharedCreatePanel :title="t('hr.docs.new')" :back-to="backTo">
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState
      v-else
      :loading="departments.isLoading.value"
      :error="departments.error.value"
      :empty="!departments.data.value?.items.length"
      :empty-text="t('hr.docs.noDepartments')"
      :empty-description="t('hr.docs.noDepartmentsHint')"
      @retry="departments.refetch"
    >
      <template v-if="can('hr.departments.manage')" #emptyAction><UButton :to="{ path: '/hr/departments/new', query: { returnTo: route.fullPath } }" :label="t('hr.depts.new')" /></template>
      <div class="space-y-6">
        <SharedFormSection :title="t('hr.docs.department')">
          <UFormField class="mt-4" :label="t('hr.docs.department')" name="new-document-department">
            <USelect
              id="new-document-department"
              :model-value="departmentId ? String(departmentId) : undefined"
              :items="departmentOptions"
              class="w-full"
              :disabled="!hydrated"
              :placeholder="t('hr.docs.chooseDepartment')"
              @update:model-value="selectDepartment"
            />
          </UFormField>
        </SharedFormSection>
        <DocumentCreateForm v-if="selectedDepartment" :department-id="departmentId" :back-to="backTo" @saved="saved" />
      </div>
    </SharedPageState>
  </SharedCreatePanel>
</template>
