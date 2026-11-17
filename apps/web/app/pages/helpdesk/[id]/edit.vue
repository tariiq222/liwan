<script setup lang="ts">
import HelpdeskTicketForm from '@/components/helpdesk/HelpdeskTicketForm.vue'
import { HELPDESK_LIST_PATH } from '@/composables/helpdesk/helpdeskKeys'
import { useHelpdeskTicket } from '@/composables/helpdesk/useHelpdesk'
import { recordParentTo } from '@/utils/recordListOrigin'

const route = useRoute()
const { t } = useI18n()
const id = computed(() => Number(route.params.id))
const query = useHelpdeskTicket(id)
const ticket = computed(() => query.data.value ?? null)
const sourcePaths = useRecordListPaths([HELPDESK_LIST_PATH])
// A child page returns to its current record; the list's referrer travels as listOrigin.
const listOrigin = computed(() => {
  const value = route.query.listOrigin ?? route.query.returnTo
  return typeof value === 'string' ? value : null
})
const backTo = computed(() => recordParentTo(`${HELPDESK_LIST_PATH}/${id.value}`, {
  ...route.query, listOrigin: listOrigin.value,
}, sourcePaths.value, typeof route.hash === 'string' ? route.hash : ''))
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('helpdesk.edit')" :back-to="backTo" />
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!ticket" @retry="query.refetch">
      <HelpdeskTicketForm v-if="ticket" :ticket="ticket" :back-to="backTo" />
    </SharedPageState>
  </SharedPageContainer>
</template>
