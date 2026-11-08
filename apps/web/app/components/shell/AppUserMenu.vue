<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { useAppearance } from '@/composables/useAppearance'
import { useLocaleChoice } from '@/composables/useLocaleChoice'
import { useSignOut } from '@/composables/useSignOut'

// The user at the far end of the top bar: avatar (with the live-connection dot), name, first role and a chevron. It
// opens a menu with the personal account page, the dark-mode switch, the language switch and sign out. On a phone the
// trigger is the avatar alone. A company switch is not offered: the product has one company per session.
const { t, locale } = useI18n()
const { me } = useMe()
const { connected } = useBus()
const hydrated = useHydrated()
const toast = useToast()
const signOut = useSignOut()
const { mode, setMode } = useAppearance()
const { other, choose } = useLocaleChoice()

const name = computed(() => me.value?.name ?? '')
const initial = computed(() => Array.from(name.value.trim())[0]?.toLocaleUpperCase() ?? '?')
// The person's first role names them under their name; a person without one shows the name alone.
const roleName = computed(() => {
  const role = me.value?.roles?.[0]
  return role ? role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar : undefined
})
const label = computed(() => name.value ? `${t('nav.userMenu.label')}: ${name.value}` : t('nav.userMenu.label'))

async function leave() {
  if (!(await signOut())) toast.add({ title: t('account.logoutFailed'), color: 'error' })
}

const items = computed<DropdownMenuItem[][]>(() => [
  [
    { type: 'label', label: name.value },
    ...(roleName.value ? [{ type: 'label' as const, label: roleName.value, class: 'font-normal text-muted' }] : []),
  ],
  [{ label: t('nav.userMenu.account'), icon: 'i-lucide-user-round', to: '/account' }],
  [
    {
      type: 'checkbox',
      label: t('nav.userMenu.darkMode'),
      icon: 'i-lucide-moon',
      checked: mode.value === 'dark',
      onUpdateChecked: (checked: boolean) => setMode(checked ? 'dark' : 'light'),
      onSelect: (event: Event) => event.preventDefault(),
    },
    { label: other.value.name, icon: 'i-lucide-languages', onSelect: () => choose(other.value.code) },
  ],
  [{ label: t('nav.logout'), icon: 'i-lucide-log-out', color: 'error', onSelect: () => { void leave() } }],
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :modal="false"
    :disabled="!hydrated"
    :content="{ align: 'end', sideOffset: 8 }"
    :ui="{ content: 'approved-account-menu min-w-56' }"
    :external-icon="false"
  >
    <button type="button" class="liwan-user" data-testid="account-menu" :disabled="!hydrated" :aria-label="label">
      <span data-slot="avatar">
        <span aria-hidden="true">{{ initial }}</span>
        <span v-if="hydrated" data-slot="status" :data-connected="connected" :title="connected ? t('bus.connected') : t('bus.disconnected')" role="status" />
      </span>
      <span data-slot="copy">
        <span data-slot="name">{{ name }}</span>
        <span v-if="roleName" data-slot="caption">{{ roleName }}</span>
      </span>
      <UIcon name="i-lucide-chevron-down" data-slot="chevron" aria-hidden="true" />
    </button>
  </UDropdownMenu>
</template>
