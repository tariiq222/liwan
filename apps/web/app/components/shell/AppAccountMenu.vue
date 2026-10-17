<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { AppearanceMode, FontSize } from '@/utils/appearance'
import { clearAiSessionState } from '@/utils/aiDraft'

// The one personal menu: account page, language, display mode, font size and sign-out.
// Mode and size are saved per user on the server (useAppearance); the language is a cookie.
const queryClient = useQueryClient()
const { t, locale, setLocale } = useI18n()
const { mode, fontSize, setMode, setFontSize } = useAppearance()
const localeCookie = useCookie<string | null>('webvue-locale', { default: () => null, path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
const languages = [{ code: 'ar', name: 'العربية' }, { code: 'en', name: 'English' }] as const
const modes: AppearanceMode[] = ['light', 'dark']
const sizes: FontSize[] = ['small', 'medium', 'large']
const modeIcons: Record<AppearanceMode, string> = { light: 'i-lucide-sun', dark: 'i-lucide-moon' }
const sizeGlyphClass: Record<FontSize, string> = { small: 'text-xs', medium: 'text-base', large: 'text-xl' }
const { me } = useMe()
const { connected } = useBus()
const hydrated = useHydrated()

const initials = computed(() => (me.value?.name ?? '?').trim().slice(0, 1))
const navPreferenceKey = computed(() => `webvue-nav:${me.value?.id ?? 'anonymous'}`)

function chooseLanguage(code: (typeof languages)[number]['code']) {
  if (locale.value === code) return
  localeCookie.value = code
  void setLocale(code)
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST', body: {} })
  sessionStorage.removeItem(navPreferenceKey.value)
  clearAiSessionState()
  await queryClient.cancelQueries()
  queryClient.clear()
  await refreshNuxtData('me')
  await navigateTo('/login')
}

// Language, mode and size are each one row of buttons (a radio group) in a custom slot that keeps the menu open.
type AccountMenuItem = DropdownMenuItem & { webvueIcon?: string, slot?: 'language' | 'mode' | 'size' }
const iconOf = (item: DropdownMenuItem) => (item as AccountMenuItem).webvueIcon
const items = computed<AccountMenuItem[][]>(() => [
  [
    { label: t('nav.account'), to: '/account', webvueIcon: 'i-lucide-user-round' },
  ],
  [
    { type: 'label' as const, label: t('nav.language') },
    { slot: 'language' as const, class: 'webvue-appearance-item', onSelect: (event: Event) => event.preventDefault() },
  ],
  [
    { type: 'label' as const, label: t('settings.appearance.mode') },
    { slot: 'mode' as const, class: 'webvue-appearance-item', onSelect: (event: Event) => event.preventDefault() },
    { type: 'label' as const, label: t('settings.appearance.fontSize') },
    { slot: 'size' as const, class: 'webvue-appearance-item', onSelect: (event: Event) => event.preventDefault() },
  ],
  [
    { label: t('nav.logout'), color: 'error' as const, webvueIcon: 'i-lucide-log-out', onSelect: () => { void logout() } },
  ],
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :modal="false"
    :disabled="!hydrated"
    :content="{
      align: 'end',
      sideOffset: 4,
      avoidCollisions: false,
      sticky: 'always',
      updatePositionStrategy: 'always',
    }"
    :ui="{ content: 'approved-account-menu z-[80] min-w-52' }"
    :external-icon="false"
  >
    <UButton
      type="button"
      data-slot="header-account"
      data-testid="account-menu"
      class="header-account"
      color="neutral"
      variant="ghost"
      :disabled="!hydrated"
      :aria-label="me?.name ? t('nav.account') + ': ' + me.name : t('nav.account')"
    >
      <span class="relative shrink-0">
        <UAvatar size="sm" :text="initials" :alt="me?.name ?? t('nav.account')" />
        <ClientOnly>
          <span
            class="absolute -bottom-0.5 -start-0.5 block size-2.5 rounded-full ring-2 ring-(--ui-bg)"
            :class="connected ? 'webvue-status-dot-success' : 'bg-(--ui-text-dimmed)'"
            :title="connected ? t('bus.connected') : t('bus.disconnected')"
            :aria-label="connected ? t('bus.connected') : t('bus.disconnected')"
            role="status"
          />
        </ClientOnly>
      </span>
      <span class="account-copy">
        <span class="account-name">{{ me?.name }}</span>
      </span>
    </UButton>
    <template #language>
      <div role="radiogroup" :aria-label="t('nav.language')" class="webvue-appearance-row">
        <UButton
          v-for="language in languages"
          :key="language.code"
          type="button"
          role="radio"
          color="neutral"
          :variant="locale === language.code ? 'subtle' : 'ghost'"
          :aria-checked="locale === language.code"
          :label="language.name"
          class="webvue-appearance-option"
          @click.stop="chooseLanguage(language.code)"
        />
      </div>
    </template>
    <template #mode>
      <div role="radiogroup" :aria-label="t('settings.appearance.mode')" class="webvue-appearance-row">
        <UButton
          v-for="value in modes"
          :key="value"
          type="button"
          role="radio"
          color="neutral"
          :variant="mode === value ? 'subtle' : 'ghost'"
          :aria-checked="mode === value"
          :aria-label="t(`settings.appearance.${value}`)"
          :title="t(`settings.appearance.${value}`)"
          :icon="modeIcons[value]"
          class="webvue-appearance-option"
          @click.stop="setMode(value)"
        />
      </div>
    </template>
    <template #size>
      <div role="radiogroup" :aria-label="t('settings.appearance.fontSize')" class="webvue-appearance-row">
        <UButton
          v-for="value in sizes"
          :key="value"
          type="button"
          role="radio"
          color="neutral"
          :variant="fontSize === value ? 'subtle' : 'ghost'"
          :aria-checked="fontSize === value"
          :aria-label="t(`settings.appearance.${value}`)"
          :title="t(`settings.appearance.${value}`)"
          class="webvue-appearance-option"
          @click.stop="setFontSize(value)"
        >
          <span aria-hidden="true" class="font-semibold leading-none" :class="sizeGlyphClass[value]">A</span>
        </UButton>
      </div>
    </template>
    <template #item-leading="{ item }">
      <UIcon v-if="iconOf(item)" :name="iconOf(item)!" class="webvue-shell-icon size-4.5 shrink-0" aria-hidden="true" />
    </template>
  </UDropdownMenu>
</template>
