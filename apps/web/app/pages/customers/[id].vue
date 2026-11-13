<script setup lang="ts">
import type { PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { normalizedPath } from '@/utils/routePath'
import { ApiError } from '@/composables/useApi'
import { useArchiveCustomer, useCustomer, useRestoreCustomer } from '@/composables/customers/useCustomers'

const route = useRoute()
const sourcePaths = useRecordListPaths(['/customers'])
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
// A trailing slash still names the record, not a child page.
const isDetail = computed(() => normalizedPath(route.path) === `/customers/${route.params.id}`)
const query = useCustomer(computed(() => isDetail.value && validId.value ? id.value : null))
const customer = computed(() => query.data.value)
// Invalid ids have no record to load and use the same not-found state as an unknown positive id.
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const canManage = computed(() => can('customers.manage'))
// A long address may wrap at the @ instead of inside a word.
const emailParts = computed(() => {
  const email = customer.value?.email ?? ''
  const at = email.indexOf('@')
  return at < 0 ? { local: email, domain: '' } : { local: email.slice(0, at), domain: email.slice(at) }
})

const confirmArchive = ref(false)
const { mutateAsync: archive, isPending: archiving } = useArchiveCustomer()
const { mutateAsync: restore, isPending: restoring } = useRestoreCustomer()
const archivePending = computed(() => archiving.value || restoring.value)
const archiveError = ref<unknown>(null)
async function toggleArchive() {
  if (!customer.value || !hydrated.value || archivePending.value) return
  try {
    if (customer.value.active) await archive(customer.value.id)
    else await restore(customer.value.id)
    confirmArchive.value = false
    archiveError.value = null
  } catch (failure) { archiveError.value = failure }
}

const headerTags = computed<PageHeaderTag[]>(() => customer.value
  ? [
      { label: t(customer.value.is_company ? 'customers.kind.company' : 'customers.kind.person'), kind: 'category', icon: customer.value.is_company ? 'i-lucide-building-2' : 'i-lucide-user-round' },
      { label: t(customer.value.active ? 'customers.status.active' : 'customers.status.archived'), tone: customer.value.active ? 'success' : 'neutral' },
    ]
  : [])
const menuActions = computed<RowAction[]>(() => {
  if (!customer.value || !canManage.value) return []
  return [{
    label: customer.value.active ? t('customers.archive') : t('customers.restore'),
    icon: customer.value.active ? 'i-lucide-archive' : 'i-lucide-archive-restore',
    destructive: customer.value.active,
    onSelect: () => { confirmArchive.value = !confirmArchive.value },
  }]
})
</script>

<template>
  <SharedRecordPage
    v-if="isDetail"
    :keep-content="!!customer"
    :title="customer?.name || t('customers.recordTitle')"
    :tags="headerTags"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="customer && canManage" #actions>
      <UButton color="primary" icon="i-lucide-pencil" :disabled="!hydrated" :to="recordChildTo(`/customers/${id}/edit`, route.query, sourcePaths, route.hash)" :label="t('app.edit')" data-testid="customer-edit" @click="!hydrated && $event.preventDefault()" />
      <SharedRowActions :actions="menuActions" :label="t('customers.rowActions', { name: customer.name })" :disabled="archivePending" />
    </template>
    <SharedInlineConfirm
      v-if="customer && confirmArchive"
      :color="customer.active ? 'error' : 'primary'"
      :title="t(customer.active ? 'customers.archiveConfirm' : 'customers.restoreConfirm', { name: customer.name })"
      :description="archiveError ? t('errors.generic') : t(customer.active ? 'customers.archiveHint' : 'customers.restoreHint')"
      :confirm-label="customer.active ? t('customers.archive') : t('customers.restore')"
      :pending="archivePending"
      @confirm="toggleArchive"
      @cancel="confirmArchive = false; archiveError = null"
    />
    <SharedIdentityCard v-if="customer" :id="customer.id" :name="customer.name" :subtitle="t(customer.is_company ? 'customers.kind.company' : 'customers.kind.person')" />
    <template v-if="customer" #aside>
      <SharedPropertiesPanel :title="t('customers.record.details')">
        <SharedPropertyRow v-if="customer.phone" :label="t('customers.form.phone')"><bdi dir="ltr" data-testid="customer-phone-value">{{ customer.phone }}</bdi></SharedPropertyRow>
        <SharedPropertyRow v-else :label="t('customers.form.phone')" />
        <SharedPropertyRow v-if="customer.email" :label="t('customers.form.email')"><bdi dir="ltr" data-testid="customer-email-value">{{ emailParts.local }}<wbr>{{ emailParts.domain }}</bdi></SharedPropertyRow>
        <SharedPropertyRow v-else :label="t('customers.form.email')" />
        <SharedPropertyRow :label="t('customers.record.parent')" :value="customer.parent?.name" />
        <SharedPropertyRow :label="t('customers.record.scope')" :value="customer.company?.name ?? t('customers.sharedByAllBranches')" />
        <SharedCustomFieldRows v-if="customer.properties.length" :fields="customer.properties" :editable="false" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
  <NuxtPage v-else />
</template>
