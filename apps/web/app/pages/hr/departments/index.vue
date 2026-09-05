<script setup lang="ts">
import DepartmentTable from '@/components/hr/DepartmentTable.vue'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useDeleteHrDepartment, useHrDepartments, type HrDepartment } from '@/composables/useHrDepartments'
import { returnToQuery } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const query = useHrDepartments()
const hydrated = useHydrated(); const deleting = ref<HrDepartment | null>(null); const deleteError = ref<ApiError | null>(null); const { mutateAsync: deleteDepartment, isPending: deletingPending } = useDeleteHrDepartment()
function openDepartment(id: number) { void navigateTo({ path: `/hr/departments/${id}`, query: returnToQuery(route.fullPath) }) }
function askDelete(department: HrDepartment) { deleting.value = department; deleteError.value = null }
async function confirmDelete() { if (!deleting.value || !hydrated.value) return; try { await deleteDepartment(deleting.value.id); deleting.value = null; toast.success(t('hr.depts.deleted')) } catch (error) { deleteError.value = error instanceof ApiError ? error : new ApiError(500, 'http_error', t('errors.generic')) } }
</script>
<template>
  <div class="space-y-6"><SharedPageHeader :title="t('hr.depts.title')" :back-to="'/hr'">
    <NuxtLink v-if="can('hr.departments.manage')" :to="{ path: '/hr/departments/new', query: returnToQuery(route.fullPath) }"><Button>{{ t('hr.depts.new') }}</Button></NuxtLink>
  </SharedPageHeader><SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value?.items.length" @retry="query.refetch"><DepartmentTable :departments="query.data.value?.items ?? []" :can-manage="can('hr.departments.manage')" @select="openDepartment" @delete="askDelete" /></SharedPageState><div v-if="deleting" class="rounded-md border border-destructive/50 p-4"><p class="text-sm">{{ t('hr.depts.deleteConfirm', { name: deleting.name }) }}</p><p v-if="deleteError" class="mt-2 text-sm text-destructive">{{ deleteError.message }}</p><div class="mt-3 flex gap-2"><Button variant="outline" :disabled="deletingPending" @click="deleting = null">{{ t('app.cancel') }}</Button><Button variant="destructive" :disabled="!hydrated || deletingPending" @click="confirmDelete">{{ t('hr.depts.delete') }}</Button></div></div></div>
</template>
