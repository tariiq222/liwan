<script setup lang="ts">
import SettingsPreviewList from '@/components/settings/SettingsPreviewList.vue'
import { useFinanceAuditEvents } from '@/composables/finance/useFinanceAudit'
import { formatAuditTime } from './auditParams'

// The latest finance audit events as compact rows inside the preview card; filters and paging live on the full log page.
const PREVIEW_ROWS = 5
const { t, locale } = useI18n()
const { can } = useAccess()
const query = useFinanceAuditEvents({ limit: PREVIEW_ROWS, offset: 0 }, () => can('finance.audit.read'))
const rows = computed(() => (query.data.value?.items ?? []).map(event => ({
  id: event.id,
  to: '/settings/apps/finance/audit',
  name: t(`financeGovernance.audit.actions.${event.action}`),
  icon: 'i-lucide-history',
  secondary: [event.actor.name, `${event.res_model} #${event.res_id}`, formatAuditTime(event.created_at, locale.value)].join(' · '),
})))
</script>

<template>
  <SettingsPreviewList :items="rows" :loading="query.isPending.value" :error="query.error.value" :empty-text="t('financeGovernance.audit.empty')" @retry="query.refetch" />
</template>
