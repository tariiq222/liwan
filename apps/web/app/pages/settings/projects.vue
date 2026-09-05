<script setup lang="ts">
import ProjectSettingsForm from '@/components/settings/ProjectSettingsForm.vue'

const { t } = useI18n()
const { me } = useMe()

// The global auth middleware already resolved `me` before this page renders,
// so `me.value` is never null here — only the role varies.
const forbidden = computed(() => me.value?.role === 'employee')
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-semibold">
      {{ t('settings.title') }} <span class="text-muted-foreground">›</span> {{ t('settings.projects.title') }}
    </h1>

    <p v-if="forbidden" class="text-muted-foreground">{{ t('settings.forbidden') }}</p>
    <ProjectSettingsForm v-else />
  </div>
</template>
