<script setup lang="ts">
import BrandingForm from '@/components/settings/BrandingForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'

const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('settings.branding.manage'))
</script>

<template>
  <SettingsLayout>
    <div class="nasq-page-stack">
      <SharedPageHeader :title="t('nav.branding')" />
    <p v-if="forbidden" class="text-muted-foreground">{{ t('settings.forbidden') }}</p>
      <BrandingForm v-else />
    </div>
  </SettingsLayout>
</template>
