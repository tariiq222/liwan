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
const localeCookie = useCookie<string | null>('nasq-locale', { default: () => null, path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
const languages = [{ code: 'ar', name: 'العربية' }, { code: 'en', name: 'English' }] as const
const modes: AppearanceMode[] = ['light', 'dark']
const sizes: FontSize[] = ['small', 'medium', 'large']
const modeIcons: Record<AppearanceMode, string> = { light: 'i-lucide-sun', dark: 'i-lucide-moon' }
const { me } = useMe()
const { connected } = useBus()
const hydrated = useHydrated()

const initials = computed(() => (me.value?.name ?? '?').trim().slice(0, 1))
const navPreferenceKey = computed(() => `nasq-nav:${me.value?.id ?? 'anonymous'}`)

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST', body: {} })
  sessionStorage.removeItem(navPreferenceKey.value)
  clearAiSessionState()
  await queryClient.cancelQueries()
  queryClient.clear()
  await refreshNuxtData('me')
  await navigateTo('/login')
}

// Checkbox items toggle; each group behaves as a radio, so only a newly checked entry changes the preference.
type AccountMenuItem = DropdownMenuItem & { nasqIcon?: string }
const iconOf = (item: DropdownMenuItem) => (item as AccountMenuItem).nasqIcon
const items = computed<AccountMenuItem[][]>(() => [
  [
    { label: t('nav.account'), to: '/account', nasqIcon: 'i-lucide-user-round' },
  ],
  [
    { type: 'label' as const, label: t('nav.language') },
    ...languages.map(language => ({
      type: 'checkbox' as const,
      label: language.name,
      checked: locale.value === language.code,
      onUpdateChecked: (checked: boolean) => {
        if (!checked) return
        localeCookie.value = language.code
        void setLocale(language.code)
      },
    })),
  ],
  [
    { type: 'label' as const, label: t('settings.appearance.mode') },
    ...modes.map(value => ({
      type: 'checkbox' as const,
      label: t(`settings.appearance.${value}`),
      nasqIcon: modeIcons[value],
      checked: mode.value === value,
      onUpdateChecked: (checked: boolean) => { if (checked) setMode(value) },
    })),
  ],
  [
    { type: 'label' as const, label: t('settings.appearance.fontSize') },
    ...sizes.map(value => ({
      type: 'checkbox' as const,
      label: t(`settings.appearance.${value}`),
      checked: fontSize.value === value,
      onUpdateChecked: (checked: boolean) => { if (checked) setFontSize(value) },
    })),
  ],
  [
    { label: t('nav.logout'), color: 'error' as const, nasqIcon: 'i-lucide-log-out', onSelect: () => { void logout() } },
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
            class="absolute -bottom-0.5 -end-0.5 block size-2.5 rounded-full ring-2 ring-background"
            :class="connected ? 'nasq-status-dot-success' : 'bg-(--ui-text-dimmed)'"
            :title="connected ? t('bus.connected') : t('bus.disconnected')"
            :aria-label="connected ? t('bus.connected') : t('bus.disconnected')"
            role="status"
          />
        </ClientOnly>
      </span>
      <span class="account-copy">
        <span class="account-name">{{ me?.name }}</span>
        <span class="account-role">{{ me?.company.name }}</span>
      </span>
    </UButton>
    <template #item-leading="{ item }">
      <UIcon v-if="iconOf(item)" :name="iconOf(item)!" class="nasq-shell-icon size-4.5 shrink-0" aria-hidden="true" />
    </template>
  </UDropdownMenu>
</template>
