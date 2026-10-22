<script setup lang="ts">
import { useEmployeeDocuments, useEmployeeDocumentLink } from '@/composables/useDocuments'
import DocumentList from '@/components/documents/DocumentList.vue'
definePageMeta({ path: '/account/documents' })
const route = useRoute(); const router = useRouter(); const { t } = useI18n(); const hydrated = useHydrated(); const { can } = useAccess()
const allowed = computed(() => can('documents.items.read') && can('hr.employees.read'))
const employee = useEmployeeDocumentLink(allowed)
const hasEmployee = computed(() => !!employee.data.value && !employee.error.value)
const noEmployee = computed(() => employee.data.value === null && !employee.error.value)
const limit = 25
const offset = computed(() => {
  const value = typeof route.query.offset === 'string' ? Number(route.query.offset) : 0
  return Number.isSafeInteger(value) && value >= 0 ? Math.floor(value / limit) * limit : 0
})
const query = useEmployeeDocuments(computed(() => ({ limit, offset: offset.value })), computed(() => allowed.value && hasEmployee.value))
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)))
const page = computed(() => Math.floor(offset.value / limit) + 1)
watch(() => query.data.value?.total, total => {
  if (!hasEmployee.value || total === undefined || offset.value === 0 || offset.value < total) return
  const lastOffset = Math.max(0, Math.ceil(total / limit) - 1) * limit
  void router.replace({ path: '/account/documents', query: lastOffset ? { offset: String(lastOffset) } : {}, hash: route.hash })
}, { immediate: true })
const listPath = computed(() => router.resolve({ path: '/account/documents', query: offset.value ? { offset: String(offset.value) } : {}, hash: route.hash }).fullPath)
function setPage(value: number) {
  if (!hydrated.value || query.isFetching.value || value < 1 || value > pages.value) return
  void router.replace({ path: '/account/documents', query: value > 1 ? { offset: String((value - 1) * limit) } : {}, hash: route.hash })
}
</script>
<template>
  <SharedListPage :title="t('documents.personal.label')">
    <SharedForbiddenState v-if="!allowed" />
    <template v-else>
      <p class="text-sm text-muted">{{ t('documents.personal.description') }}</p>
      <SharedListCard>
        <SharedPageState :loading="employee.isLoading.value || (hasEmployee && query.isLoading.value)" :error="employee.error.value || (hasEmployee ? query.error.value : null)" @retry="employee.error.value ? employee.refetch() : query.refetch()">
          <SharedEmptyState v-if="noEmployee" class="m-(--webvue-card-pad-dense)" :title="t('documents.personal.noEmployee')" :description="t('documents.personal.noEmployeeHelp')" />
          <SharedEmptyState v-else-if="!items.length" class="m-(--webvue-card-pad-dense)" :title="t('documents.personal.empty')" :description="t('documents.personal.emptyHelp')">
            <template #icon><UIcon name="i-lucide-files" class="size-6" /></template>
          </SharedEmptyState>
          <DocumentList v-else :documents="items" record-base="/account/documents" :return-to="listPath" />
        </SharedPageState>
        <template v-if="hasEmployee && query.data.value && items.length" #footer>
          <SharedListFooter :count-label="t('documents.footer.results', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="query.isFetching.value || !hydrated" @update:page="setPage" />
        </template>
      </SharedListCard>
    </template>
  </SharedListPage>
</template>
