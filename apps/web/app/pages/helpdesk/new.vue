<script setup lang="ts">
import HelpdeskTicketDirectory from '@/components/helpdesk/HelpdeskTicketDirectory.vue'
import HelpdeskTicketForm from '@/components/helpdesk/HelpdeskTicketForm.vue'
import { HELPDESK_LIST_PATH } from '@/composables/helpdesk/helpdeskKeys'
import { safeListReturnTo } from '@/composables/useRouteListFilters'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const backTo = computed(() => safeListReturnTo(HELPDESK_LIST_PATH, route.query.returnTo))
function opened(ticket: { id: number }) {
  void navigateTo({ path: `${HELPDESK_LIST_PATH}/${ticket.id}`, query: { returnTo: backTo.value } }, { replace: true })
}
</script>

<template>
  <SharedListPage :title="t('helpdesk.title')" hide-header>
    <HelpdeskTicketDirectory background />
  </SharedListPage>
  <SharedCreatePanel :title="t('helpdesk.new')" :back-to="backTo">
    <SharedForbiddenState v-if="!can('helpdesk.tickets.write') && !can('helpdesk.requests.create')" />
    <HelpdeskTicketForm v-else :back-to="backTo" @saved="opened" />
  </SharedCreatePanel>
</template>
