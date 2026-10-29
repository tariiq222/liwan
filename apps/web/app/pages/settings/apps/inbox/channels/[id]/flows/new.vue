<script setup lang="ts">
import InboxFlowCreateForm from '@/components/inbox/InboxFlowCreateForm.vue'
import InboxFlowList from '@/components/inbox/InboxFlowList.vue'
import { flowsRoute } from '@/composables/inbox/inboxFlow'

// Create a form: the route-backed create panel over the channel's forms list. The form is stored as a draft in WebVue
// and Meta, and its builder opens next; nothing is published here.
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const id = computed(() => {
  const value = Number(route.params.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const backTo = computed(() => flowsRoute(id.value ?? 0, route.query))
const savedTo = (flowId: number) => flowsRoute(id.value ?? 0, route.query, `/${flowId}`)
</script>

<template>
  <template v-if="id">
    <SharedRecordPage :title="t('inbox.flows.title')" hide-header><InboxFlowList :channel-id="id" /></SharedRecordPage>
    <SharedCreatePanel :title="t('inbox.flows.create')" :description="t('inbox.flows.createHint')" :back-to="backTo">
      <InboxFlowCreateForm v-if="can('inbox.flows.manage')" :channel-id="id" :back-to="backTo" @saved="flow => navigateTo(savedTo(flow.id), { replace: true })" />
      <SharedForbiddenState v-else />
    </SharedCreatePanel>
  </template>
  <SharedNotFoundState v-else />
</template>
