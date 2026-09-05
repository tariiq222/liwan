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
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">{{ t('settings.title') }}</h1>
    <SettingsTabs />

    <p v-if="forbidden" class="text-muted-foreground">{{ t('settings.forbidden') }}</p>
    <ProjectSettingsForm v-else />
  </div>
</template>
