<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AppearanceMode } from '@/utils/appearance'
import { createBrandTheme } from '@/utils/brandTheme'

const props = defineProps<{
  name: string
  color: string
  secondaryColor?: string
  logoUrl: string
}>()

const { t } = useI18n()
const previewMode = ref<AppearanceMode>('light')
const theme = computed(() => createBrandTheme(props.color, previewMode.value, props.secondaryColor))
</script>

<template>
  <div data-testid="branding-preview" :data-preview-primary="theme['--primary']" :class="{ dark: previewMode === 'dark', cream: previewMode === 'cream' }" :style="theme">
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <div>
          <h2 class="font-semibold">{{ t('settings.branding.preview.title') }}</h2>
          <p class="text-sm text-muted">{{ t('settings.branding.preview.hint') }}</p>
        </div>
        <div class="flex items-center gap-1 rounded-lg border border-default p-1 text-xs">
          <UButton
            type="button"
            size="xs"
            :variant="previewMode === 'light' ? 'soft' : 'ghost'"
            color="neutral"
            @click="previewMode = 'light'"
          >
            {{ t('settings.branding.preview.modes.light') }}
          </UButton>
          <UButton
            type="button"
            size="xs"
            :variant="previewMode === 'cream' ? 'soft' : 'ghost'"
            color="neutral"
            @click="previewMode = 'cream'"
          >
            {{ t('settings.branding.preview.modes.cream') }}
          </UButton>
          <UButton
            type="button"
            size="xs"
            :variant="previewMode === 'dark' ? 'soft' : 'ghost'"
            color="neutral"
            @click="previewMode = 'dark'"
          >
            {{ t('settings.branding.preview.modes.dark') }}
          </UButton>
        </div>
      </div>
    </template>
    <div class="space-y-4">
      <div class="flex items-center gap-3 rounded-lg px-4 py-3" style="background: var(--shell-background); color: var(--shell-foreground)">
        <img v-if="logoUrl" :src="logoUrl" :alt="name" class="size-12 rounded-md object-contain bg-white/80">
        <span class="font-semibold">{{ name }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UButton type="button" data-testid="branding-preview-action">{{ t('settings.branding.preview.action') }}</UButton>
        <span class="nasq-ui-selected inline-flex min-h-9 items-center px-3 text-sm font-medium">{{ t('settings.branding.preview.selection') }}</span>
        <UInput :aria-label="t('settings.branding.preview.action')" :placeholder="t('settings.branding.preview.action')" class="w-40" readonly />
      </div>
      <div class="nasq-ui-tab-strip">
        <UButton type="button" color="neutral" variant="ghost" class="nasq-ui-tab" aria-current="page">{{ t('settings.branding.preview.action') }}</UButton>
        <UButton type="button" color="neutral" variant="ghost" class="nasq-ui-tab">{{ t('settings.branding.preview.selection') }}</UButton>
      </div>
      <UCard>
        <p class="text-sm">{{ t('settings.branding.preview.hint') }}</p>
      </UCard>
      <div>
        <p class="mb-1 text-xs text-muted">{{ t('settings.branding.preview.progress') }}</p>
        <UProgress :model-value="66" :style="{ '--nasq-ui-progress': '66%' }" class="nasq-ui-progress" size="sm" :aria-label="t('settings.branding.preview.progress')" />
      </div>
      <div>
        <p class="mb-1 text-xs text-muted">{{ t('settings.branding.preview.charts') }}</p>
        <div class="flex gap-1.5">
          <span v-for="index in 6" :key="index" class="size-5 rounded-full" :style="{ background: `var(--chart-${index})` }" />
        </div>
      </div>
      <UAlert color="info" variant="subtle" :title="t('settings.branding.preview.hint')" />
    </div>
  </UCard>
  </div>
</template>
