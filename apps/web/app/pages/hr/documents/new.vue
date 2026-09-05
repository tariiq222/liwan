<script setup lang="ts">
import DocumentCreateForm from '@/components/hr/DocumentCreateForm.vue'
import { useHrDepartments } from '@/composables/useHrDepartments'
import { safeReturnTo, returnToQuery } from '@/utils/safeReturnTo'
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const departments = useHrDepartments()
const departmentId = ref(typeof route.query.department_id === 'string' ? Number(route.query.department_id) : 0)
const selectedDepartment = computed(() => departments.data.value?.items.find(d => d.id === departmentId.value))
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/hr/documents', ['/hr']))
function selectDepartment(event: Event) { departmentId.value = Number((event.target as HTMLSelectElement).value) }
function saved(id: number) { void navigateTo({ path: `/hr/departments/${departmentId.value}/documents/${id}`, query: returnToQuery(returnTo.value) }) }
</script>
<template>
  <div class="space-y-6">
    <SharedPageHeader :title="t('hr.docs.new')" :back-to="returnTo" />
    <SharedPageState :loading="departments.isLoading.value" :error="departments.error.value" :empty="!departments.data.value?.items.length" @retry="departments.refetch">
      <div class="grid max-w-2xl gap-2"><Label for="new-document-department">{{ t('hr.docs.department') }}</Label>
        <select id="new-document-department" :value="departmentId || ''" :disabled="!hydrated" class="h-9 rounded-md border bg-background px-3 text-sm" @change="selectDepartment">
          <option value="">{{ t('hr.docs.chooseDepartment') }}</option><option v-for="department in departments.data.value?.items" :key="department.id" :value="department.id">{{ department.name }}</option>
        </select>
      </div>
    </SharedPageState>
    <DocumentCreateForm v-if="selectedDepartment" :department-id="departmentId" :back-to="returnTo" @saved="saved" />
  </div>
</template>
