<script setup lang="ts">
import InboxCatalogCard from '@/components/inbox/InboxCatalogCard.vue'
import { useInboxCatalogs } from '@/composables/inbox/useInboxCatalog'

// The connected catalogs, one card per WhatsApp business account; with none connected, an empty state whose action
// opens the route-backed connect panel (/settings/apps/inbox/catalog/new).
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const manage = computed(() => can('inbox.catalog.manage'))
const query = useInboxCatalogs(manage)
const items = computed(() => query.data.value?.items ?? [])
</script>

<template>
  <SharedForbiddenState v-if="!manage" />
  <SharedLoadingSkeleton v-else-if="query.isPending.value" />
  <SharedPageState v-else-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
  <SharedEmptyState v-else-if="!items.length" bordered :title="t('inbox.catalog.empty')" :description="t('inbox.catalog.emptyDescription')" data-testid="inbox-catalog-empty">
    <template #icon><UIcon name="i-lucide-store" class="size-8" /></template>
    <template #action><UButton to="/settings/apps/inbox/catalog/new" icon="i-lucide-plus" :disabled="!hydrated" :label="t('inbox.catalog.connect.title')" data-testid="inbox-catalog-connect-cta" /></template>
  </SharedEmptyState>
  <div v-else class="flex flex-col gap-(--liwan-gap-card)">
    <InboxCatalogCard v-for="catalog in items" :key="catalog.id" :catalog="catalog" :manage="manage" />
  </div>
</template>
