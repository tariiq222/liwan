<script setup lang="ts">
import InboxCatalogConnectForm from '@/components/inbox/InboxCatalogConnectForm.vue'
import InboxCatalogsSection from '@/components/inbox/InboxCatalogsSection.vue'

// Connect a catalog: the route-backed create panel over the catalogs list.
const { t } = useI18n()
const { can } = useAccess()
const backTo = '/settings/apps/inbox/catalog'
</script>

<template>
  <SharedRecordPage :title="t('inbox.catalog.title')" hide-header><InboxCatalogsSection /></SharedRecordPage>
  <SharedCreatePanel :title="t('inbox.catalog.connect.title')" :description="t('inbox.catalog.connect.hint')" :back-to="backTo">
    <InboxCatalogConnectForm v-if="can('inbox.catalog.manage')" :back-to="backTo" @saved="catalog => navigateTo(`${backTo}/${catalog.id}`, { replace: true })" />
    <SharedForbiddenState v-else />
  </SharedCreatePanel>
</template>
