<script setup lang="ts">
import ZatcaView from '@/components/finance/governance/ZatcaView.vue'
import { useFinanceZatcaStatus } from '@/composables/finance/useFinanceZatca'
import type { PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'

const { t } = useI18n()
const { can } = useAccess()
const allowed = computed(() => can('finance.zatca.read'))
const status = useFinanceZatcaStatus(allowed)
// E-invoicing is sandbox-only in this phase: the tag says which ZATCA environment the company talks to.
const tags = computed<PageHeaderTag[]>(() => {
  const data = status.data.value
  if (!data) return []
  return [
    { label: t(`financeGovernance.zatca.modes.${data.api_mode}`), tone: data.api_mode === 'sandbox' ? 'warning' : 'neutral', testId: 'finance-zatca-mode' },
    { label: t(data.onboarded ? 'financeGovernance.zatca.onboarded' : 'financeGovernance.zatca.notOnboarded'), tone: data.onboarded ? 'success' : 'warning', testId: 'finance-zatca-onboarded' },
  ]
})
</script>

<template>
  <SharedSettingsPage width="detail">
    <SharedPageHeader :title="t('financeGovernance.zatca.title')" :tags="tags" />
    <SharedForbiddenState v-if="!allowed" :description="t('financeGovernance.forbidden')" />
    <ZatcaView v-else />
  </SharedSettingsPage>
</template>
