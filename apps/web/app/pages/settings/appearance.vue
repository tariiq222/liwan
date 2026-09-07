<script setup lang="ts">
import BrandingForm from '@/components/settings/BrandingForm.vue'
import AppearanceForm from '@/components/settings/AppearanceForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'

const { t } = useI18n()
const { can } = useAccess()
const sections = computed(() => [
  { id: 'appearance-mode', label: t('settings.appearance.mode') },
  { id: 'appearance-font', label: t('settings.appearance.fontSize') },
  ...(can('settings.branding.manage') ? [{ id: 'branding', label: t('settings.branding.color') }] : []),
])
</script>

<template>
  <SettingsLayout :sections>
    <div class="nasq-page-stack nasq-settings-form-page">
      <SharedPageHeader :title="t('settings.appearance.title')" />
      <div class="nasq-panel nasq-panel-body" data-testid="appearance-form">
        <AppearanceForm />
        <section v-if="can('settings.branding.manage')" id="branding" class="nasq-form-section nasq-settings-anchor">
          <h2 class="nasq-settings-section-heading">{{ t('settings.branding.color') }}</h2>
          <BrandingForm />
        </section>
      </div>
    </div>
  </SettingsLayout>
</template>
