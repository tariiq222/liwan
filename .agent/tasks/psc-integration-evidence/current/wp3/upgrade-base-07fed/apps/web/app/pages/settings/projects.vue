<script setup lang="ts">
import ProjectSettingsForm from '@/components/settings/ProjectSettingsForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'

const { t } = useI18n()
const { can } = useAccess()

// The global auth middleware already resolved `me` before this page renders,
// so `me.value` is never null here — only the role varies.
const forbidden = computed(() => !can('pmo.settings.manage'))
</script>

<template>
  <SettingsLayout>
    <div class="nasq-page-stack">
      <SharedPageHeader :title="t('settings.title')" />

      <p v-if="forbidden" class="text-muted-foreground">{{ t('settings.forbidden') }}</p>
      <ProjectSettingsForm v-else />
    </div>
  </SettingsLayout>
</template>
