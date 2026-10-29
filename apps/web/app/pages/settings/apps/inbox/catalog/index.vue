<script setup lang="ts">
import InboxCatalogsSection from '@/components/inbox/InboxCatalogsSection.vue'

// The WhatsApp product catalog of the company: connect one, see its sync status, and open it to manage its items.
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
</script>

<template>
  <SharedRecordPage :title="t('inbox.catalog.title')" back-to="/settings/apps/inbox" :back-label="t('inbox.title')">
    <template v-if="can('inbox.catalog.manage')" #actions>
      <UButton to="/settings/apps/inbox/catalog/new" icon="i-lucide-plus" :disabled="!hydrated" :label="t('inbox.catalog.connect.title')" data-testid="inbox-catalog-connect" />
    </template>
    <InboxCatalogsSection />
  </SharedRecordPage>
</template>
