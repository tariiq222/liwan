<script setup lang="ts">
import AccountsSection from '@/components/finance/records/AccountsSection.vue'

const { t } = useI18n()
const { can } = useAccess()
const allowed = computed(() => can('finance.accounts.read'))
</script>

<template>
  <SharedSettingsPage width="detail">
    <SharedPageHeader :title="t('financeRecords.accounts.title')" />
    <SharedForbiddenState v-if="!allowed" :description="t('financeRecords.forbidden')" />
    <AccountsSection v-else />
  </SharedSettingsPage>
</template>
