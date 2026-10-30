<script setup lang="ts">
import type { InboxFlowSummary } from '@liwan/contracts'
import { FLOW_HEALTH_TONE, FLOW_STATUS_TONE } from '@/composables/inbox/inboxFlow'

// A form's lifecycle state, with its sending health when Meta reports a problem (limited or blocked) and a mark for a
// form made in WhatsApp Manager, which LiwanOS sends but cannot show or edit.
const props = defineProps<{ flow: Pick<InboxFlowSummary, 'status' | 'health' | 'supported'> }>()
const { t } = useI18n()
const showHealth = computed(() => props.flow.status === 'published' && (props.flow.health === 'limited' || props.flow.health === 'blocked'))
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-2">
    <SharedStatusBadge v-if="!props.flow.supported" size="sm" tone="neutral" :label="t('inbox.flows.external')" data-testid="inbox-flow-external-badge" />
    <SharedStatusBadge size="sm" :tone="FLOW_STATUS_TONE[props.flow.status]" :label="t(`inbox.flows.status.${props.flow.status}`)" data-testid="inbox-flow-status-badge" />
    <SharedStatusBadge v-if="showHealth" size="sm" :tone="FLOW_HEALTH_TONE[props.flow.health]" :label="t(`inbox.flows.health.${props.flow.health}`)" data-testid="inbox-flow-health-badge" />
  </span>
</template>
