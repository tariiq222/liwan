<script setup lang="ts">
import InboxFlowBuilder from '@/components/inbox/InboxFlowBuilder.vue'
import InboxFlowLifecycle from '@/components/inbox/InboxFlowLifecycle.vue'
import InboxFlowState from '@/components/inbox/InboxFlowState.vue'
import { flowsRoute } from '@/composables/inbox/inboxFlow'
import { useInboxFlow } from '@/composables/inbox/useInboxFlows'

// One form: its builder with the live preview (read-only once it is published, deprecated or made outside WebVue), the
// state in the header, and the lifecycle actions (Meta preview, publish, deprecate, copy, delete) under the builder.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const positive = (value: unknown) => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}
const channelId = computed(() => positive(route.params.id))
const flowId = computed(() => positive(route.params.flowId))
const backTo = computed(() => flowsRoute(channelId.value ?? 0, route.query))
const query = useInboxFlow(flowId)
const flow = query.data
const builder = ref<{ dirty: boolean } | null>(null)
const readonly = computed(() => !can('inbox.flows.manage') || !flow.value?.editable)
// A flow of another channel answers on this URL too: send it to its own page instead of editing under the wrong channel.
const mismatch = computed(() => !!flow.value && flow.value.channel.id !== channelId.value)
</script>

<template>
  <SharedNotFoundState v-if="mismatch" :back-to="backTo" :back-label="t('inbox.flows.title')" />
  <SharedRecordPage
    v-else
    :title="flow?.name ?? t('inbox.flows.title')"
    :back-to="backTo"
    :back-label="t('inbox.flows.title')"
    :loading="flowId !== null && query.isPending.value"
    :error="flowId === null || channelId === null ? { status: 404 } : query.error.value"
    @retry="hydrated && query.refetch()"
  >
    <template v-if="flow && channelId">
      <p class="flex flex-wrap items-center gap-2 text-sm text-muted"><InboxFlowState :flow="flow" /></p>
      <InboxFlowBuilder :key="`${flow.id}-${flow.status}-${flow.editable}`" ref="builder" :flow="flow" :readonly="readonly" :back-to="backTo" />
      <InboxFlowLifecycle
        :flow="flow"
        :dirty="builder?.dirty"
        @copied="copy => navigateTo(flowsRoute(channelId!, route.query, `/${copy.id}`))"
        @deleted="navigateTo(backTo, { replace: true })"
      />
    </template>
  </SharedRecordPage>
</template>
