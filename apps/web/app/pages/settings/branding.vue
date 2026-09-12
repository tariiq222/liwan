<script setup lang="ts">
import BrandingForm from '@/components/settings/BrandingForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'

const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('settings.branding.manage'))
</script>

<template>
  <SettingsLayout width="form">
    <SharedPageHeader :title="t('settings.branding.title')" />
    <p v-if="forbidden" class="text-muted">{{ t('settings.forbidden') }}</p>
    <div v-else>
      <BrandingForm />
    </div>
  </SettingsLayout>
</template>
