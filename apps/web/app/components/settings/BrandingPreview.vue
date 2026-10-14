<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AppearanceMode } from '@/utils/appearance'
import { createBrandTheme } from '@/utils/brandTheme'
import { DARK_SURFACES } from '@/utils/nasqPalette'

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
  dark: {
    '--ui-bg': DARK_SURFACES.bg,
    '--ui-bg-muted': DARK_SURFACES.muted,
    '--ui-bg-elevated': DARK_SURFACES.elevated,
    '--ui-bg-accented': DARK_SURFACES.accented,
    '--ui-border': DARK_SURFACES.border,
    '--ui-border-muted': DARK_SURFACES.borderMuted,
    '--ui-border-accented': DARK_SURFACES.borderAccented,
    '--ui-text': '#e2e8f0',
    '--ui-text-highlighted': '#e2e8f0',
    '--ui-text-muted': '#94a3b8',
    '--ui-text-dimmed': '#94a3b8',
    '--ui-text-toned': '#94a3b8',
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
    :class="{ dark: previewMode === 'dark' }"
    :style="previewStyle"
  >
  <UCard class="rounded-lg ring ring-default bg-default overflow-hidden" :ui="{ header: '' }">
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
            :variant="previewMode === 'dark' ? 'soft' : 'ghost'"
            color="neutral"
            @click="previewMode = 'dark'"
          >
            {{ t('settings.branding.preview.modes.dark') }}
          </UButton>
        </div>
      </div>
    </template>
    <div class="overflow-hidden rounded-lg ring ring-default bg-muted" data-testid="branding-preview-app">
      <div class="flex items-center gap-3 bg-[var(--nasq-rail)] px-3 py-2 text-white">
        <img v-if="logoUrl" :src="logoUrl" alt="" class="size-7 rounded-md object-contain bg-white/80">
        <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ name }}</span>
        <span class="size-6 rounded-full bg-white/20" aria-hidden="true" />
      </div>
      <div class="flex">
        <div class="flex w-11 shrink-0 flex-col items-center gap-2 border-e border-default bg-default py-3" aria-hidden="true">
          <span class="grid size-7 place-items-center rounded-md bg-primary/10 text-primary"><UIcon name="i-lucide-layout-dashboard" class="size-4" /></span>
          <span class="grid size-7 place-items-center rounded-md text-muted"><UIcon name="i-lucide-list-checks" class="size-4" /></span>
          <span class="grid size-7 place-items-center rounded-md text-muted"><UIcon name="i-lucide-users" class="size-4" /></span>
        </div>
        <div class="min-w-0 flex-1 space-y-3 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="font-semibold">{{ t('settings.branding.preview.sample') }}</p>
            <UButton type="button" size="sm" data-testid="branding-preview-action">{{ t('settings.branding.preview.action') }}</UButton>
          </div>
          <div class="space-y-3 rounded-lg bg-default p-3 ring ring-default">
            <div class="flex flex-wrap items-center gap-2">
              <span class="bg-primary/10 text-primary inline-flex min-h-7 items-center rounded-md px-2 text-sm font-medium">{{ t('settings.branding.preview.selection') }}</span>
              <UInput :aria-label="t('settings.branding.preview.action')" :placeholder="t('settings.branding.preview.action')" class="w-36" size="sm" readonly />
            </div>
            <div class="flex flex-wrap gap-1.5">
              <UBadge color="success" variant="subtle">{{ t('settings.branding.preview.states.done') }}</UBadge>
              <UBadge color="info" variant="subtle">{{ t('settings.branding.preview.states.active') }}</UBadge>
              <UBadge color="warning" variant="subtle">{{ t('settings.branding.preview.states.risk') }}</UBadge>
              <UBadge color="error" variant="subtle">{{ t('settings.branding.preview.states.late') }}</UBadge>
              <UBadge color="neutral" variant="subtle">{{ t('settings.branding.preview.states.draft') }}</UBadge>
            </div>
            <div>
              <p class="mb-1 text-xs text-muted">{{ t('settings.branding.preview.progress') }}</p>
              <UProgress :model-value="66" size="sm" :aria-label="t('settings.branding.preview.progress')" />
            </div>
            <div>
              <p class="mb-1 text-xs text-muted">{{ t('settings.branding.preview.charts') }}</p>
              <div class="flex gap-1.5">
                <span v-for="index in 6" :key="index" class="size-5 rounded-full" :style="{ background: `var(--chart-${index})` }" />
              </div>
            </div>
          </div>
          <UAlert color="info" variant="subtle" :title="t('settings.branding.preview.notice')" />
        </div>
      </div>
    </div>
  </UCard>
  </div>
</template>
