<script setup lang="ts">
import DocumentCreateForm from '@/components/hr/DocumentCreateForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { safeReturnTo, returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const departments = useHrDepartments()
const canManage = computed(() => can('hr.documents.manage'))
const departmentId = ref(typeof route.query.department_id === 'string' ? Number(route.query.department_id) : 0)
const departmentOptions = computed(() => (departments.data.value?.items ?? []).map(department => ({ value: String(department.id), label: department.name })))
const selectedDepartment = computed(() => departments.data.value?.items.find(d => d.id === departmentId.value))
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/hr/documents', ['/hr']))

function selectDepartment(value: unknown) {
  departmentId.value = value ? Number(value) : 0
}
function saved(id: number) {
  void navigateTo({ path: `/hr/departments/${departmentId.value}/documents/${id}`, query: returnToQuery(returnTo.value) })
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.docs.new')" :back-to="returnTo" />
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState
      v-else
      :loading="departments.isLoading.value"
      :error="departments.error.value"
      :empty="!departments.data.value?.items.length"
      @retry="departments.refetch"
    >
      <UCard class="space-y-6">
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
        <DocumentCreateForm v-if="selectedDepartment" :department-id="departmentId" :back-to="returnTo" @saved="saved" />
      </UCard>
    </SharedPageState>
  </SharedPageContainer>
</template>
