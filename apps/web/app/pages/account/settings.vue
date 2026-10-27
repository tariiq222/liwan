<script setup lang="ts">
import PasswordForm from '@/components/account/PasswordForm.vue'

import { useQueryClient } from '@tanstack/vue-query'
import type { AppearanceMode, FontSize } from '@/utils/appearance'
import { clearAiSessionState } from '@/utils/aiDraft'
import { useAiConversation } from '@/composables/useAiConversation'

// Personal preferences keep their existing persistence and session cleanup.
// Mode and size are saved per user on the server (useAppearance); the language is a cookie.
const queryClient = useQueryClient()
const { clear: clearAiConversation } = useAiConversation()
const { t, locale, setLocale } = useI18n()
const toast = useToast()
const { mode, fontSize, setMode, setFontSize } = useAppearance()
const localeCookie = useCookie<string | null>('webvue-locale', { default: () => null, path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
const languages = [{ code: 'ar', name: 'العربية' }, { code: 'en', name: 'English' }] as const
const modes: AppearanceMode[] = ['light', 'dark']
const sizes: FontSize[] = ['small', 'medium', 'large']
const modeIcons: Record<AppearanceMode, string> = { light: 'i-lucide-sun', dark: 'i-lucide-moon' }
const sizeGlyphClass: Record<FontSize, string> = { small: 'text-xs', medium: 'text-base', large: 'text-xl' }
const { me } = useMe()
const hydrated = useHydrated()

const navPreferenceKey = computed(() => `webvue-nav:${me.value?.id ?? 'anonymous'}`)

function chooseLanguage(code: (typeof languages)[number]['code']) {
  if (locale.value === code) return
  localeCookie.value = code
  void setLocale(code)
}

async function logout() {
  try {
    await $fetch('/api/auth/logout', { method: 'POST', body: {} })
    sessionStorage.removeItem(navPreferenceKey.value)
    clearAiSessionState()
    clearAiConversation()
    await queryClient.cancelQueries()
    queryClient.clear()
    await refreshNuxtData('me')
    await navigateTo('/login')
  } catch {
    toast.add({ title: t('account.logoutFailed'), color: 'error' })
    await refreshNuxtData('me')
  }
}

</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('account.settings')" icon="i-lucide-settings-2" back-to="/account" :back-label="t('nav.account')" />
    <SharedPropertiesPanel v-if="me" :title="t('account.identity')">
      <SharedPropertyRow :label="t('auth.username')"><bdi dir="ltr">{{ me.login }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t('account.company')" :value="me.company.name" />
    </SharedPropertiesPanel>
    <SharedFormSection panel :title="t('account.preferences')">
      <div class="space-y-5">
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">{{ t('nav.language') }}</legend>
          <div role="radiogroup" :aria-label="t('nav.language')" class="flex flex-wrap gap-2">
            <UButton v-for="language in languages" :key="language.code" type="button" role="radio" color="neutral" :variant="locale === language.code ? 'subtle' : 'outline'" :aria-checked="locale === language.code" :label="language.name" :disabled="!hydrated" @click="chooseLanguage(language.code)" />
          </div>
        </fieldset>
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">{{ t('settings.appearance.mode') }}</legend>
          <div role="radiogroup" :aria-label="t('settings.appearance.mode')" class="flex flex-wrap gap-2">
            <UButton v-for="value in modes" :key="value" type="button" role="radio" color="neutral" :variant="mode === value ? 'subtle' : 'outline'" :aria-checked="mode === value" :label="t(`settings.appearance.${value}`)" :icon="modeIcons[value]" :disabled="!hydrated" @click="setMode(value)" />
          </div>
        </fieldset>
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">{{ t('settings.appearance.fontSize') }}</legend>
          <div role="radiogroup" :aria-label="t('settings.appearance.fontSize')" class="flex flex-wrap gap-2">
            <UButton v-for="value in sizes" :key="value" type="button" role="radio" color="neutral" :variant="fontSize === value ? 'subtle' : 'outline'" :aria-checked="fontSize === value" :aria-label="t(`settings.appearance.${value}`)" :disabled="!hydrated" @click="setFontSize(value)">
              <span aria-hidden="true" class="font-semibold" :class="sizeGlyphClass[value]">A</span>{{ t(`settings.appearance.${value}`) }}
            </UButton>
          </div>
        </fieldset>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('account.passwordTitle')"><PasswordForm /></SharedFormSection>
    <UButton type="button" color="neutral" variant="outline" icon="i-lucide-log-out" :label="t('nav.logout')" :disabled="!hydrated" @click="logout" />
  </SharedSettingsPage>
</template>
