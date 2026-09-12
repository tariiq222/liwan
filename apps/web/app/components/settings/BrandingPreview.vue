<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AppearanceMode } from '@/utils/appearance'
import { createBrandTheme } from '@/utils/brandTheme'

const props = defineProps<{
  name: string
  color: string
  logoUrl: string
}>()

const { t } = useI18n()
const previewMode = ref<AppearanceMode>('light')
const theme = computed(() => createBrandTheme(props.color, previewMode.value))
const modeSurfaceTokens: Record<AppearanceMode, Record<string, string>> = {
  light: {
    '--ui-bg': '#ffffff',
    '--ui-bg-muted': '#f8f9fc',
    '--ui-bg-elevated': '#ffffff',
    '--ui-bg-accented': '#eef1f7',
    '--ui-border': '#e5e8ef',
    '--ui-border-muted': '#e5e8ef',
    '--ui-border-accented': '#d9dde7',
    '--ui-text': '#171923',
    '--ui-text-highlighted': '#171923',
    '--ui-text-muted': '#656c7e',
    '--ui-text-dimmed': '#656c7e',
    '--ui-text-toned': '#656c7e',
  },
  cream: {
    '--ui-bg': '#fffdf8',
    '--ui-bg-muted': '#f6f1e7',
    '--ui-bg-elevated': '#efe8d9',
    '--ui-bg-accented': '#e4d9c6',
    '--ui-border': '#d8cbb7',
    '--ui-border-muted': '#e4d9c6',
    '--ui-border-accented': '#c2b293',
    '--ui-text': '#3f3428',
    '--ui-text-highlighted': '#30271f',
    '--ui-text-muted': '#746753',
    '--ui-text-dimmed': '#746753',
    '--ui-text-toned': '#63533f',
  },
  dark: {
    '--ui-bg': '#181b24',
    '--ui-bg-muted': '#1e222c',
    '--ui-bg-elevated': '#181b24',
    '--ui-bg-accented': '#272c38',
    '--ui-border': '#2d3340',
    '--ui-border-muted': '#2d3340',
    '--ui-border-accented': '#394150',
    '--ui-text': '#f6f7fb',
    '--ui-text-highlighted': '#f6f7fb',
    '--ui-text-muted': '#a9b0bf',
    '--ui-text-dimmed': '#a9b0bf',
    '--ui-text-toned': '#a9b0bf',
  },
}
const previewStyle = computed(() => {
  const surfaces = modeSurfaceTokens[previewMode.value]
  const brandAliases = {
    '--ui-primary': 'var(--brand-link)',
    '--ui-secondary': 'var(--primary-fill)',
    '--primary-2': 'color-mix(in srgb, var(--primary) 78%, #fff)',
    '--brand-soft': 'color-mix(in srgb, var(--primary) 8%, var(--card))',
    '--brand-border': 'color-mix(in srgb, var(--primary) 24%, var(--border))',
    '--color-brand-50': 'color-mix(in srgb, var(--primary) 5%, white)',
    '--color-brand-100': 'color-mix(in srgb, var(--primary) 10%, white)',
    '--color-brand-200': 'color-mix(in srgb, var(--primary) 20%, white)',
    '--color-brand-300': 'color-mix(in srgb, var(--primary) 35%, white)',
    '--color-brand-400': 'var(--brand-link)',
    '--color-brand-500': 'var(--brand-link)',
    '--color-brand-600': 'var(--primary-hover)',
    '--color-brand-700': 'var(--primary-active)',
    '--color-brand-800': 'color-mix(in srgb, var(--primary) 80%, black)',
    '--color-brand-900': 'color-mix(in srgb, var(--primary) 65%, black)',
    '--color-brand-950': 'color-mix(in srgb, var(--primary) 50%, black)',
    '--color-brand-link': 'var(--brand-link)',
    '--color-brand-soft': 'var(--brand-soft)',
    '--color-brand-border': 'var(--brand-border)',
  }
  return {
    ...theme.value,
    ...surfaces,
    ...brandAliases,
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
  <UCard class="nasq-ui-record-surface" :ui="{ header: 'nasq-ui-card-header' }">
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
