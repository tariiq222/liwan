<script setup lang="ts">
import InboxCatalogItemForm from '@/components/inbox/InboxCatalogItemForm.vue'
import InboxCatalogItemsSection from '@/components/inbox/InboxCatalogItemsSection.vue'
import { useInboxCatalog } from '@/composables/inbox/useInboxCatalog'

// Add a product to the catalog: the route-backed create panel over the catalog's items (an existing product, or a new
// one made here with a picture).
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => {
  const value = Number(route.params.catalogId)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const manage = computed(() => can('inbox.catalog.manage'))
const catalog = useInboxCatalog(id)
const backTo = computed(() => ({ path: `/settings/apps/inbox/catalog/${id.value}`, query: route.query }))
</script>

<template>
  <template v-if="id">
    <SharedRecordPage :title="t('inbox.catalog.title')" hide-header><InboxCatalogItemsSection :catalog-id="id" :manage="manage" /></SharedRecordPage>
    <SharedCreatePanel :title="t('inbox.catalog.items.add')" :description="t('inbox.catalog.itemForm.createHint')" :back-to="backTo">
      <InboxCatalogItemForm v-if="manage" :catalog-id="id" :currency="catalog.data.value?.currency" :back-to="`/settings/apps/inbox/catalog/${id}`" @saved="item => navigateTo(`/settings/apps/inbox/catalog/${id}/items/${item.id}`, { replace: true })" />
      <SharedForbiddenState v-else />
    </SharedCreatePanel>
  </template>
  <SharedNotFoundState v-else />
</template>
