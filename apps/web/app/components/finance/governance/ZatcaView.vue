<script setup lang="ts">
import { useFinanceZatcaStatus } from '@/composables/finance/useFinanceZatca'
import ZatcaBacklog from './ZatcaBacklog.vue'
import ZatcaJournals from './ZatcaJournals.vue'
import ZatcaWorkList from './ZatcaWorkList.vue'

// The e-invoicing page body: the submission backlog, the documents waiting on ZATCA, then the journals and their onboarding.
const { t } = useI18n()
const { can } = useAccess()
const status = useFinanceZatcaStatus(() => can('finance.zatca.read'))
</script>

<template>
  <SharedPageState :loading="status.isLoading.value" :error="status.error.value" :empty="!status.data.value" @retry="status.refetch">
    <div v-if="status.data.value" class="grid gap-(--liwan-gap-card)">
      <SharedRecordSection variant="panel" :title="t('financeGovernance.zatca.environment.title')">
        <p class="font-semibold">{{ t(`financeGovernance.zatca.environment.modes.${status.data.value.api_mode}`) }}</p>
        <p class="mt-1 text-sm text-muted">{{ t('financeGovernance.zatca.environment.releaseGate') }}</p>
      </SharedRecordSection>
      <UAlert v-if="status.data.value.overdue_reporting" color="warning" variant="subtle"
        :title="t('financeGovernance.zatca.backlog.overdueReporting', { count: status.data.value.overdue_reporting })" />
      <ZatcaBacklog :backlog="status.data.value.backlog" />
      <ZatcaWorkList />
      <ZatcaJournals :journals="status.data.value.journals" :onboarding-available="status.data.value.api_mode === 'sandbox'" />
      <p class="text-sm text-muted">
        {{ t('financeGovernance.zatca.setupHint') }}
        <NuxtLink to="/settings/apps/finance#setup" class="text-primary hover:underline">{{ t('financeGovernance.zatca.setupLink') }}</NuxtLink>
      </p>
    </div>
  </SharedPageState>
</template>
