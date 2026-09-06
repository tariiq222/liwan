<script setup lang="ts">
import BrandingForm from '@/components/settings/BrandingForm.vue'
import AppearanceForm from '@/components/settings/AppearanceForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'

const { t } = useI18n()
const { can } = useAccess()
</script>

<template>
  <SettingsLayout>
    <div class="nasq-page-stack nasq-settings-form-page">
      <SharedPageHeader :title="t('settings.appearance.title')" />
      <AppearanceForm />
      <section v-if="can('settings.branding.manage')" id="branding" class="nasq-panel">
        <header class="nasq-panel-header"><h2 class="font-semibold">{{ t('settings.branding.color') }}</h2></header>
        <div class="nasq-panel-body"><BrandingForm /></div>
      </section>
    </div>
  </SettingsLayout>
</template>
