<script setup lang="ts">
import BrandingForm from '@/components/settings/BrandingForm.vue'
import SettingsTabs from '@/components/settings/SettingsTabs.vue'

const { t } = useI18n()
const { me } = useMe()
const forbidden = computed(() => me.value?.role === 'employee')
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">{{ t('settings.title') }}</h1>
    <SettingsTabs />
    <p v-if="forbidden" class="text-muted-foreground">{{ t('settings.forbidden') }}</p>
    <BrandingForm v-else />
  </div>
</template>
