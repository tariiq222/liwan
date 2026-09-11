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
const modeSurfaceTokens: Record<AppearanceMode, Record<string, string>> = {
  light: {
    '--ui-bg': '#ffffff',
    '--ui-bg-muted': '#f5f6f8',
    '--ui-bg-elevated': '#ebedf0',
    '--ui-bg-accented': '#ebedf0',
    '--ui-border': '#e1e3e7',
    '--ui-border-muted': '#eaebee',
    '--ui-border-accented': '#d1d4d9',
    '--ui-text': '#18181b',
    '--ui-text-highlighted': '#09090b',
    '--ui-text-muted': '#71717a',
    '--ui-text-toned': '#52525b',
  },
  cream: {
    '--ui-bg': '#fbf7ef',
    '--ui-bg-muted': '#f6f1e7',
    '--ui-bg-elevated': '#efe8d9',
    '--ui-bg-accented': '#e4d9c6',
    '--ui-border': '#d8cbb7',
    '--ui-border-muted': '#e4d9c6',
    '--ui-border-accented': '#c2b293',
    '--ui-text': '#3f3428',
    '--ui-text-highlighted': '#30271f',
    '--ui-text-muted': '#746753',
    '--ui-text-toned': '#63533f',
  },
  dark: {
    '--ui-bg': '#09090b',
    '--ui-bg-muted': '#18181b',
    '--ui-bg-elevated': '#27272a',
    '--ui-bg-accented': '#27272a',
    '--ui-border': '#3f3f46',
    '--ui-border-muted': '#34343c',
    '--ui-border-accented': '#52525b',
    '--ui-text': '#f4f4f5',
    '--ui-text-highlighted': '#fafafa',
    '--ui-text-muted': '#a1a1aa',
    '--ui-text-toned': '#71717a',
  },
}
const previewStyle = computed(() => {
  const surfaces = modeSurfaceTokens[previewMode.value]
  return {
    ...theme.value,
    ...surfaces,
    color: 'var(--ui-text)',
    background: 'var(--ui-bg)',
    '--background': surfaces['--ui-bg'],
    '--foreground': surfaces['--ui-text'],
    '--card': surfaces['--ui-bg'],
    '--muted': surfaces['--ui-bg-muted'],
    '--muted-foreground': surfaces['--ui-text-muted'],
    '--border': surfaces['--ui-border'],
    '--accent': surfaces['--ui-bg-accented'],
  }
})
</script>

<template>
  <div
    data-testid="branding-preview"
    :data-preview-primary="theme['--primary']"
    class="overflow-hidden rounded-xl"
    :class="{ dark: previewMode === 'dark', cream: previewMode === 'cream' }"
    :style="previewStyle"
  >
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
      <div class="nasq-ui-record-surface p-4">
        <p class="text-sm">{{ t('settings.branding.preview.hint') }}</p>
      </div>
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
