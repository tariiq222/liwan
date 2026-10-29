<script setup lang="ts">
import { statusTag } from '@webvue/ui/app/utils/pageHeaderTag'
import InboxCatalogItemsSection from '@/components/inbox/InboxCatalogItemsSection.vue'
import InboxCatalogSettingsForm from '@/components/inbox/InboxCatalogSettingsForm.vue'
import { CATALOG_STATE_TONE } from '@/composables/inbox/inboxCommerce'
import { useDeleteInboxCatalog, useInboxCatalog, useSyncInboxCatalog } from '@/composables/inbox/useInboxCatalog'

// One catalog: its defaults (brand, product link, VAT), its items with their sync and review status, "sync now" and the
// inline-confirmed removal (Meta keeps the items; orders keep their lines).
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { can } = useAccess()
const id = computed(() => {
  const value = Number(route.params.catalogId)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const backTo = '/settings/apps/inbox/catalog'
const manage = computed(() => can('inbox.catalog.manage'))
const query = useInboxCatalog(id)
const catalog = query.data
const { mutate: sync, isPending: syncing } = useSyncInboxCatalog()
const { mutate: remove, isPending: removing } = useDeleteInboxCatalog()
const confirmingDelete = ref(false)
const tags = computed(() => (catalog.value ? [statusTag({ tone: CATALOG_STATE_TONE[catalog.value.state], label: t(`inbox.catalog.states.${catalog.value.state}`) })] : []))
const fail = (e: unknown) => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })
</script>

<template>
  <SharedRecordPage
    :title="catalog?.name || t('inbox.catalog.title')"
    :tags="tags"
    :back-to="backTo"
    :back-label="t('inbox.catalog.title')"
    :loading="id !== null && query.isPending.value"
    :error="id === null ? { status: 404 } : query.error.value"
    @retry="hydrated && query.refetch()"
  >
    <template v-if="catalog && manage" #actions>
      <UButton type="button" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="syncing" :disabled="!hydrated || syncing" :label="t('inbox.catalog.syncNow')" data-testid="inbox-catalog-page-sync" @click="sync(catalog.id, { onSuccess: () => toast.add({ title: t('inbox.catalog.syncStarted'), color: 'success' }), onError: fail })" />
    </template>
    <SharedForbiddenState v-if="!manage" />
    <template v-else-if="catalog">
      <UAlert v-if="catalog.last_error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('inbox.catalog.lastError')" :description="catalog.last_error" />
      <InboxCatalogSettingsForm :catalog="catalog" :manage="manage" />
      <InboxCatalogItemsSection :catalog-id="catalog.id" :manage="manage" />
      <SharedRecordSection variant="panel" :title="t('inbox.catalog.dangerTitle')">
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="min-w-0 flex-1 text-sm text-muted">{{ t('inbox.catalog.deleteHint') }}</p>
            <UButton type="button" color="error" variant="outline" :disabled="!hydrated || confirmingDelete" :label="t('inbox.catalog.delete')" data-testid="inbox-catalog-delete" @click="confirmingDelete = true" />
          </div>
          <SharedInlineConfirm
            v-if="confirmingDelete"
            :title="t('inbox.catalog.deleteTitle', { name: catalog.name })"
            :description="t('inbox.catalog.deleteDescription')"
            :confirm-label="t('inbox.catalog.delete')"
            :pending="removing"
            @confirm="remove(catalog.id, { onSuccess: () => navigateTo(backTo, { replace: true }), onError: fail })"
            @cancel="confirmingDelete = false"
          />
        </div>
      </SharedRecordSection>
    </template>
  </SharedRecordPage>
</template>
