<script setup lang="ts">
import HelpdeskTicketDirectory from '@/components/helpdesk/HelpdeskTicketDirectory.vue'
import { HELPDESK_LIST_KEYS, HELPDESK_LIST_PATH } from '@/composables/helpdesk/helpdeskKeys'
import { listLocation } from '@/composables/useRouteListFilters'

const { t } = useI18n()
const route = useRoute()
const { can } = useAccess()
// The create link carries the list's state as its returnTo, so closing the panel returns to the same list.
const createTo = computed(() => (can('helpdesk.tickets.write') || can('helpdesk.requests.create'))
  ? { path: '/helpdesk/new', query: { returnTo: listLocation(HELPDESK_LIST_PATH, HELPDESK_LIST_KEYS, route.query, route.hash) } }
  : undefined)
</script>

<template>
  <SharedListPage :title="t('helpdesk.title')" :description="t('helpdesk.subtitle')" :create-to="createTo" :create-label="t('helpdesk.new')" create-test-id="helpdesk-new">
    <HelpdeskTicketDirectory />
  </SharedListPage>
</template>
