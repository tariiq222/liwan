<script setup lang="ts">
import ProjectSettingsForm from '@/components/settings/ProjectSettingsForm.vue'
import SettingsTabs from '@/components/settings/SettingsTabs.vue'

const { t } = useI18n()
const { can } = useAccess()

// The global auth middleware already resolved `me` before this page renders,
// so `me.value` is never null here — only the role varies.
const forbidden = computed(() => !can('pmo.settings.manage'))
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-8">
    <SharedPageHeader :title="t('settings.title')" />
    <SettingsTabs />

    <p v-if="forbidden" class="text-muted-foreground">{{ t('settings.forbidden') }}</p>
    <ProjectSettingsForm v-else />
  </div>
</template>
