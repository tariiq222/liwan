<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import PartnerProperties from '@/components/finance/PartnerProperties.vue'
import type { PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'
import { partnerKinds } from '@/composables/finance/financePartnerParams'
import { useArchiveFinancePartner, useFinancePartner, useUnarchiveFinancePartner } from '@/composables/finance/useFinancePartners'

const route = useRoute()
const sourcePaths = useRecordListPaths(['/finance/partners'])
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.partnerId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const isDetail = computed(() => route.path === `/finance/partners/${route.params.partnerId}`)
const query = useFinancePartner(computed(() => isDetail.value && validId.value ? id.value : null))
const partner = computed(() => query.data.value)
// Invalid ids have no record to load and use the same not-found state as an unknown positive id.
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))

const confirmArchive = ref(false)
const { mutateAsync: archive, isPending: archiving } = useArchiveFinancePartner()
const { mutateAsync: unarchive, isPending: unarchiving } = useUnarchiveFinancePartner()
const archivePending = computed(() => archiving.value || unarchiving.value)
const archiveError = ref<unknown>(null)
async function toggleArchive() {
  if (!partner.value || !hydrated.value || archivePending.value) return
  try {
    if (partner.value.active) await archive(partner.value.id)
    else await unarchive(partner.value.id)
    confirmArchive.value = false
    archiveError.value = null
  } catch (failure) { archiveError.value = failure }
}

// The kind tags come first, then the state; a partner that is both a customer and a vendor shows both.
const headerTags = computed<PageHeaderTag[]>(() => partner.value
  ? [
      ...partnerKinds(partner.value).map((kind): PageHeaderTag => ({ label: t(`finance.partners.kind.${kind}`), kind: 'category', icon: kind === 'customer' ? 'i-lucide-user-round' : 'i-lucide-store' })),
      ...(partner.value.vat ? [{ label: partner.value.vat, kind: 'category', icon: 'i-lucide-hash', testId: 'finance-partner-vat' } satisfies PageHeaderTag] : []),
      { label: t(partner.value.active ? 'finance.partners.status.active' : 'finance.partners.status.archived'), tone: partner.value.active ? 'success' : 'neutral' },
    ]
  : [])
const menuActions = computed<RowAction[]>(() => {
  if (!partner.value || !can('finance.partners.manage')) return []
  return [{
    label: partner.value.active ? t('finance.partners.archive') : t('finance.partners.unarchive'),
    icon: partner.value.active ? 'i-lucide-archive' : 'i-lucide-archive-restore',
    destructive: partner.value.active,
    onSelect: () => { confirmArchive.value = !confirmArchive.value },
  }]
})
</script>

<template>
  <SharedRecordPage
    v-if="isDetail"
    :keep-content="!!partner"
    :title="partner?.name || t('finance.partners.recordTitle')"
    :tags="headerTags"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="partner && can('finance.partners.manage')" #actions>
      <UButton color="primary" icon="i-lucide-pencil" :disabled="!hydrated" :to="recordChildTo(`/finance/partners/${id}/edit`, route.query, sourcePaths, route.hash)" :label="t('app.edit')" @click="!hydrated && $event.preventDefault()" />
      <SharedRowActions :actions="menuActions" :label="t('finance.partners.rowActions', { name: partner.name })" :disabled="archivePending" />
    </template>
    <SharedInlineConfirm
      v-if="partner && confirmArchive"
      :color="partner.active ? 'error' : 'primary'"
      :title="t(partner.active ? 'finance.partners.archiveConfirm' : 'finance.partners.unarchiveConfirm', { name: partner.name })"
      :description="archiveError ? t('errors.generic') : t('finance.partners.archiveHint')"
      :confirm-label="partner.active ? t('finance.partners.archive') : t('finance.partners.unarchive')"
      :pending="archivePending"
      @confirm="toggleArchive"
      @cancel="confirmArchive = false; archiveError = null"
    />
    <SharedIdentityCard v-if="partner" :id="partner.id" :name="partner.name" :subtitle="t(partner.is_company ? 'finance.partners.form.company' : 'finance.partners.form.individual')" />
    <template v-if="partner" #aside>
      <PartnerProperties :partner="partner" />
    </template>
  </SharedRecordPage>
  <NuxtPage v-else />
</template>
