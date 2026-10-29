<script setup lang="ts">
import type { InboxCatalogPickItem } from '@webvue/contracts'
import { formatInboxMoney } from '@/composables/inbox/inboxCommerce'

// The product list of a conversation's or channel's catalog, with a search box: tap a product to pick it, tap again to
// drop it. It only reports the tap (`toggle`); the editor that owns the draft decides where the product goes and how
// many may be picked. `max` is Meta's limit of the message being built.
const q = defineModel<string>('q', { default: '' })
const props = defineProps<{ items: InboxCatalogPickItem[]; picked: string[]; max: number; loading?: boolean; error?: unknown }>()
const emit = defineEmits<{ toggle: [retailerId: string]; retry: [] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const full = computed(() => props.picked.length >= props.max)
const isPicked = (item: InboxCatalogPickItem) => props.picked.includes(item.product_retailer_id)
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="inbox-product-picker">
    <UInput v-model="q" class="w-full" icon="i-lucide-search" :placeholder="t('inbox.catalog.picker.search')" :aria-label="t('inbox.catalog.picker.search')" :disabled="!hydrated" data-testid="inbox-product-search" />
    <p class="text-xs text-muted" data-testid="inbox-product-count" aria-live="polite">{{ t('inbox.catalog.picker.count', { n: props.picked.length, max: props.max }) }}</p>
    <SharedLoadingSkeleton v-if="props.loading && !props.items.length" />
    <SharedPageState v-else-if="props.error" :error="props.error" @retry="emit('retry')" />
    <p v-else-if="!props.items.length" class="text-sm text-muted" data-testid="inbox-product-empty">{{ q.trim() ? t('app.noResults') : t('inbox.catalog.picker.empty') }}</p>
    <ul v-else class="flex max-h-72 flex-col divide-y divide-default overflow-y-auto rounded-control ring ring-default" :aria-label="t('inbox.catalog.picker.listLabel')">
      <li v-for="item in props.items" :key="item.id">
        <button
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
          :class="{ 'bg-(--brand-soft)': isPicked(item) }"
          :aria-pressed="isPicked(item)"
          :disabled="!hydrated || (full && !isPicked(item))"
          :data-testid="`inbox-product-${item.id}`"
          @click="emit('toggle', item.product_retailer_id)"
        >
          <InboxProductImage :src="item.image_url" class="size-10 shrink-0 rounded-control" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-highlighted">{{ item.name }}</span>
            <span class="block truncate text-xs text-muted"><bdi dir="ltr">{{ item.product_retailer_id }}</bdi> · {{ formatInboxMoney(item.price, item.currency, locale) }}</span>
          </span>
          <SharedStatusBadge v-if="item.availability === 'out_of_stock'" size="sm" tone="neutral" :label="t('inbox.catalog.availability.out_of_stock')" />
          <UIcon :name="isPicked(item) ? 'i-lucide-circle-check' : 'i-lucide-circle'" class="size-5 shrink-0" :class="isPicked(item) ? 'text-primary' : 'text-muted'" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>
