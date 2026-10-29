<script setup lang="ts">
import JournalsSection from '@/components/finance/records/JournalsSection.vue'

const { t } = useI18n()
const { can } = useAccess()
const allowed = computed(() => can('finance.journals.read'))
</script>

<template>
  <SharedSettingsPage width="list">
    <SharedPageHeader :title="t('financeRecords.journals.title')" />
    <SharedForbiddenState v-if="!allowed" :description="t('financeRecords.forbidden')" />
    <JournalsSection v-else />
  </SharedSettingsPage>
</template>
