<script setup lang="ts">
import { statusTag } from '@webvue/ui/app/utils/pageHeaderTag'
import InboxCatalogItemForm from '@/components/inbox/InboxCatalogItemForm.vue'
import { REVIEW_TONE, SYNC_STATE_TONE } from '@/composables/inbox/inboxCommerce'
import { useDeleteInboxCatalogItem, useInboxCatalogItem } from '@/composables/inbox/useInboxCatalog'

// One catalog item: its sync and review status, the editable fields, and the inline-confirmed removal (the item leaves
// Meta first, then WebVue).
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { can } = useAccess()
const positive = (value: unknown) => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}
const catalogId = computed(() => positive(route.params.catalogId))
const id = computed(() => positive(route.params.itemId))
const backTo = computed(() => `/settings/apps/inbox/catalog/${catalogId.value}`)
const manage = computed(() => can('inbox.catalog.manage'))
const query = useInboxCatalogItem(id)
const item = query.data
const { mutate: remove, isPending: removing } = useDeleteInboxCatalogItem()
const confirmingDelete = ref(false)
const tags = computed(() => (item.value
  ? [statusTag({ tone: SYNC_STATE_TONE[item.value.sync_state], label: t(`inbox.catalog.sync.${item.value.sync_state}`) }), statusTag({ tone: REVIEW_TONE[item.value.review_status], label: t(`inbox.catalog.review.${item.value.review_status}`) })]
  : []))
</script>

<template>
  <SharedRecordPage
    :title="item?.name ?? t('inbox.catalog.items.title')"
    :tags="tags"
    :back-to="backTo"
    :back-label="t('inbox.catalog.title')"
    :loading="id !== null && query.isPending.value"
    :error="id === null || catalogId === null ? { status: 404 } : query.error.value"
    @retry="hydrated && query.refetch()"
  >
    <SharedForbiddenState v-if="!manage" />
    <template v-else-if="item">
      <UAlert v-if="item.sync_error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('inbox.catalog.itemForm.syncError')" :description="item.sync_error" />
      <UAlert v-if="item.review_reason" role="alert" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('inbox.catalog.reviewReason')" :description="item.review_reason" />
      <InboxCatalogItemForm :key="`${item.id}-${item.last_synced_at}`" :catalog-id="item.catalog_id" :item="item" :back-to="backTo" @saved="navigateTo(backTo)" />
      <SharedRecordSection variant="panel" :title="t('inbox.catalog.dangerTitle')">
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="min-w-0 flex-1 text-sm text-muted">{{ t('inbox.catalog.items.deleteHint') }}</p>
            <UButton type="button" color="error" variant="outline" :disabled="!hydrated || confirmingDelete" :label="t('inbox.catalog.items.delete')" data-testid="inbox-catalog-item-delete" @click="confirmingDelete = true" />
          </div>
          <SharedInlineConfirm
            v-if="confirmingDelete"
            :title="t('inbox.catalog.items.deleteTitle', { name: item.name })"
            :description="t('inbox.catalog.items.deleteDescription')"
            :confirm-label="t('inbox.catalog.items.delete')"
            :pending="removing"
            @confirm="remove(item.id, { onSuccess: () => navigateTo(backTo, { replace: true }), onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }) })"
            @cancel="confirmingDelete = false"
          />
        </div>
      </SharedRecordSection>
    </template>
  </SharedRecordPage>
</template>
