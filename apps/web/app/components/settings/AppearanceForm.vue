<script setup lang="ts">
import { Moon, Sun, Check } from '@lucide/vue'
import type { AppearanceMode, FontSize } from '@/utils/appearance'

const { t } = useI18n()
const { mode, fontSize, setMode, setFontSize } = useAppearance()
const hydrated = useHydrated()
const modes: AppearanceMode[] = ['light', 'dark']
const sizes: FontSize[] = ['small', 'medium', 'large']
const previewSizes = { small: '14px', medium: '16px', large: '18px' }
</script>

<template>
  <fieldset id="appearance-mode" class="nasq-form-section nasq-settings-anchor space-y-4" :disabled="!hydrated">
      <legend class="sr-only">{{ t('settings.appearance.mode') }}</legend>
      <div>
        <h2 class="font-semibold">{{ t('settings.appearance.mode') }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.appearance.modeHint') }}</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label v-for="value in modes" :key="value" class="relative cursor-pointer">
          <input
            class="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-wait" type="radio" name="appearance-mode" :value="value"
            :checked="mode === value" :data-testid="`appearance-mode-${value}`"
            @change="setMode(value)"
          >
          <span class="flex h-full min-h-24 items-center justify-center gap-3 rounded-lg border bg-background p-4 text-sm peer-checked:border-ring peer-checked:bg-brand-soft peer-checked:text-brand-link peer-focus-visible:ring-1 peer-focus-visible:ring-[var(--focus-color)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background">
            <component :is="value === 'light' ? Sun : Moon" class="size-[18px]" aria-hidden="true" />
            {{ t(`settings.appearance.${value}`) }}
            <Check v-if="mode === value" class="size-[18px]" aria-hidden="true" />
          </span>
        </label>
      </div>
    </fieldset>

    <fieldset id="appearance-font" class="nasq-form-section nasq-settings-anchor space-y-4" :disabled="!hydrated">
      <legend class="sr-only">{{ t('settings.appearance.fontSize') }}</legend>
      <div>
        <h2 class="font-semibold">{{ t('settings.appearance.fontSize') }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.appearance.fontHint') }}</p>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <label v-for="value in sizes" :key="value" class="relative cursor-pointer">
          <input
            class="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-wait" type="radio" name="appearance-font" :value="value"
            :checked="fontSize === value" :data-testid="`appearance-font-${value}`"
            @change="setFontSize(value)"
          >
          <span class="flex h-full min-h-24 flex-col items-center justify-center gap-2 rounded-lg border bg-background p-3 text-sm peer-checked:border-ring peer-checked:bg-brand-soft peer-checked:text-brand-link peer-focus-visible:ring-1 peer-focus-visible:ring-[var(--focus-color)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background">
            <span class="font-semibold" :style="{ fontSize: previewSizes[value] }">{{ t(`settings.appearance.${value}`) }}</span>
            <span v-if="value === 'small'" class="text-xs text-muted-foreground">{{ t('settings.appearance.default') }}</span>
            <Check v-if="fontSize === value" class="size-[18px]" aria-hidden="true" />
          </span>
        </label>
      </div>
      <p class="pt-4 text-sm text-muted-foreground">{{ t('settings.appearance.savedHint') }}</p>
    </fieldset>
</template>
