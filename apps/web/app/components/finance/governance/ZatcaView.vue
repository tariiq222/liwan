<script setup lang="ts">
import { useFinanceZatcaStatus } from '@/composables/finance/useFinanceZatca'
import ZatcaBacklog from './ZatcaBacklog.vue'
import ZatcaJournals from './ZatcaJournals.vue'

// The e-invoicing page body: the submission backlog, then the journals and their onboarding.
const { t } = useI18n()
const { can } = useAccess()
const status = useFinanceZatcaStatus(() => can('finance.zatca.read'))
</script>

<template>
  <SharedPageState :loading="status.isLoading.value" :error="status.error.value" :empty="!status.data.value" @retry="status.refetch">
    <div v-if="status.data.value" class="grid gap-(--webvue-gap-card)">
      <ZatcaBacklog :backlog="status.data.value.backlog" />
      <ZatcaJournals :journals="status.data.value.journals" />
      <p class="text-sm text-muted">
        {{ t('financeGovernance.zatca.setupHint') }}
        <NuxtLink to="/settings/apps/finance" class="text-primary hover:underline">{{ t('financeGovernance.zatca.setupLink') }}</NuxtLink>
      </p>
    </div>
  </SharedPageState>
</template>
