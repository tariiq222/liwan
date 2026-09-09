<script setup lang="ts">
import AppearanceForm from '@/components/settings/AppearanceForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'

const { t } = useI18n()
const sections = computed(() => [
  { id: 'appearance-mode', label: t('settings.appearance.mode') },
  { id: 'appearance-font', label: t('settings.appearance.fontSize') },
])
</script>

<template>
  <SettingsLayout :sections width="form">
    <SharedPageHeader :title="t('settings.appearance.title')" />
    <div class="nasq-panel nasq-panel-body" data-testid="appearance-form">
      <AppearanceForm />
    </div>
  </SettingsLayout>
</template>
