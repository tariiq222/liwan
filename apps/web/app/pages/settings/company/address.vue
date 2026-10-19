<script setup lang="ts">
import CompanyProfileForm from '@/components/settings/CompanyProfileForm.vue'

const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('settings.company.read'))
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('settings.sections.company.address')" />
    <SharedForbiddenState v-if="forbidden" :description="t('settings.forbidden')" />
    <CompanyProfileForm v-else section="address" />
  </SharedSettingsPage>
</template>
