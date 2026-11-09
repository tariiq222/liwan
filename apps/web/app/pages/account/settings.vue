<script setup lang="ts">
import PasswordForm from '@/components/account/PasswordForm.vue'
import RememberedDevicesSection from '@/components/account/RememberedDevicesSection.vue'

import type { AppearanceMode, FontSize } from '@/utils/appearance'
import { useLocaleChoice } from '@/composables/useLocaleChoice'
import { useSignOut } from '@/composables/useSignOut'

// Personal preferences keep their existing persistence and session cleanup.
// Mode and size are saved per user on the server (useAppearance); the language is a cookie.
const signOut = useSignOut()
const { t, locale } = useI18n()
const toast = useToast()
const { mode, fontSize, setMode, setFontSize } = useAppearance()
const { languages, choose: chooseLanguage } = useLocaleChoice()
const modes: AppearanceMode[] = ['light', 'dark']
const sizes: FontSize[] = ['small', 'medium', 'large']
const modeIcons: Record<AppearanceMode, string> = { light: 'i-lucide-sun', dark: 'i-lucide-moon' }
const sizeGlyphClass: Record<FontSize, string> = { small: 'text-xs', medium: 'text-base', large: 'text-xl' }
const { me } = useMe()
const hydrated = useHydrated()

async function logout() {
  if (!(await signOut())) toast.add({ title: t('account.logoutFailed'), color: 'error' })
}

</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('account.settings')" icon="i-lucide-settings-2" back-to="/account" :back-label="t('nav.account')" />
    <SharedPropertiesPanel v-if="me" :title="t('account.identity')">
      <SharedPropertyRow :label="t('auth.username')"><bdi dir="ltr">{{ me.login }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t('account.mobile')">
        <bdi v-if="me.mobile" dir="ltr">{{ me.mobile }}</bdi>
        <span v-else class="text-muted">{{ t('account.noMobile') }}</span>
        <UButton to="/account/mobile" color="neutral" variant="link" size="sm" :label="t('account.changeMobile')" />
      </SharedPropertyRow>
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
    <RememberedDevicesSection />
    <UButton type="button" color="neutral" variant="outline" icon="i-lucide-log-out" :label="t('nav.logout')" :disabled="!hydrated" @click="logout" />
  </SharedSettingsPage>
</template>
