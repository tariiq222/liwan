<script setup lang="ts">
import { computed } from 'vue'
import { createBrandTheme } from '@/utils/brandTheme'

const props = defineProps<{
  name: string
  color: string
  secondaryColor?: string
  logoUrl: string
}>()

const { t } = useI18n()
const theme = computed(() => createBrandTheme(props.color, 'light', props.secondaryColor))
const previewStyle = computed(() => Object.fromEntries(
  Object.entries(theme.value).map(([key, value]) => [`--preview-${key.slice(2)}`, value]),
))
</script>

<template>
  <UCard data-testid="branding-preview" :data-preview-primary="theme['--primary']" :style="previewStyle">
    <template #header>
      <h2 class="font-semibold">{{ t('settings.branding.preview.title') }}</h2>
      <p class="text-sm text-muted">{{ t('settings.branding.preview.hint') }}</p>
    </template>
    <div class="space-y-4">
      <div class="flex items-center gap-3 rounded-lg border p-4">
        <img v-if="logoUrl" :src="logoUrl" :alt="name" class="size-12 rounded-md object-contain">
        <span class="font-semibold">{{ name }}</span>
      </div>
      <div class="flex flex-wrap gap-2 rounded-lg border p-4">
        <UButton type="button" data-testid="branding-preview-action" :style="{ background: theme['--primary'], color: theme['--primary-foreground'] }">{{ t('settings.branding.preview.action') }}</UButton>
        <UButton type="button" color="secondary" :style="{ background: theme['--nasq-brand-secondary'], color: theme['--nasq-brand-secondary-foreground'] }">{{ t('settings.branding.secondaryColor') }}</UButton>
      </div>
    </div>
  </UCard>
</template>
