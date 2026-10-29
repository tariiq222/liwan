<script setup lang="ts">
import type { InboxCatalogItem } from '@webvue/contracts'
import { REVIEW_TONE, SYNC_STATE_TONE, formatInboxMoney } from '@/composables/inbox/inboxCommerce'
import { usePatchInboxCatalogItem } from '@/composables/inbox/useInboxCatalog'

// The catalog's items: picture, name and price, the sync status and Meta's review status, the error text when a push or
// the review failed, and a switch that lists or unlists the item. A row opens the item's page.
const props = defineProps<{ items: InboxCatalogItem[]; manage: boolean }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutate: patch } = usePatchInboxCatalogItem()
function toggle(item: InboxCatalogItem, listed: boolean) {
  patch({ id: item.id, body: { listed } }, { onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }) })
}
</script>

<template>
  <ul class="flex flex-col divide-y divide-default" :aria-label="t('inbox.catalog.items.title')" data-testid="inbox-catalog-items">
    <li v-for="item in props.items" :key="item.id" class="flex flex-wrap items-center gap-3 px-(--webvue-card-pad) py-3" :data-testid="`inbox-catalog-item-${item.id}`">
      <InboxProductImage :src="item.image?.url ?? null" class="size-12 shrink-0 rounded-control" />
      <NuxtLink :to="`/settings/apps/inbox/catalog/${item.catalog_id}/items/${item.id}`" class="min-w-0 flex-1 text-start focus-visible:outline-2 focus-visible:outline-primary">
        <span class="block truncate text-sm font-medium text-highlighted" :class="{ 'text-muted': !item.listed }">{{ item.name }}</span>
        <span class="block truncate text-xs text-muted"><bdi dir="ltr">{{ item.product_retailer_id }}</bdi> · {{ formatInboxMoney(item.price, item.currency, locale) }} · {{ t(`inbox.catalog.availability.${item.availability}`) }}</span>
        <span class="mt-1 flex flex-wrap gap-1">
          <SharedStatusBadge size="sm" :tone="SYNC_STATE_TONE[item.sync_state]" :label="t(`inbox.catalog.sync.${item.sync_state}`)" data-testid="inbox-item-sync" />
          <SharedStatusBadge size="sm" :tone="REVIEW_TONE[item.review_status]" :label="t(`inbox.catalog.review.${item.review_status}`)" data-testid="inbox-item-review" />
        </span>
        <span v-if="item.sync_error" class="block text-xs text-error" data-testid="inbox-item-error">{{ item.sync_error }}</span>
        <span v-if="item.review_reason" class="block text-xs text-error">{{ t('inbox.catalog.reviewReason') }}: <bdi>{{ item.review_reason }}</bdi></span>
      </NuxtLink>
      <USwitch :model-value="item.listed" :disabled="!hydrated || !props.manage" :aria-label="t('inbox.catalog.items.listed', { name: item.name })" :data-testid="`inbox-item-listed-${item.id}`" @update:model-value="toggle(item, $event)" />
    </li>
  </ul>
</template>
