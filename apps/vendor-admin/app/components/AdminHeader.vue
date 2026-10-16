<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ShellRailItem } from '@webvue/ui/app/types/shell'
import { usePageHeaderTitle } from '@webvue/ui/app/composables/usePageHeader'

// The 48px neutral header: mobile menu, breadcrumb, the console badge that marks this as the
// vendor console, and the account menu (language, appearance, sign-out).
const props = defineProps<{ items: ShellRailItem[], activeId: string | null }>()
const { t, te, locale, locales } = useI18n()
const { me, signOut } = useAdminSession()
const hydrated = useHydrated()
const pageTitle = usePageHeaderTitle()
const route = useRoute()
const { choose } = useLocalePreference()
const { mode, setMode } = useAppearance()
const toast = useToast()

const modes = [{ value: 'light', icon: 'i-lucide-sun' }, { value: 'dark', icon: 'i-lucide-moon' }] as const
type MenuItem = DropdownMenuItem & { webvueIcon?: string }

const initials = computed(() => Array.from((me.value?.display_name ?? '?').trim())[0] ?? '?')
const roleNames = computed(() => (me.value?.roles ?? []).map(role => (te(`app.shell.roles.${role}`) ? t(`app.shell.roles.${role}`) : role)).join('، '))
const section = computed(() => props.items.find(item => item.id === props.activeId))
// The page registers its title after the server rendered the header; show it only once hydrated so both renders match.
const crumbs = computed(() => {
  const tab = hydrated.value ? catalogTabOf(route.path) : null
  return adminCrumbs({
    section: section.value ? { label: t(section.value.labelKey), to: section.value.to } : null,
    tab: tab ? { label: t(tab.labelKey), to: tab.to } : null,
    title: hydrated.value ? pageTitle.value : null,
  })
})

async function leave() {
  try {
    await signOut()
  } catch {
    toast.add({ title: t('app.shell.signOutFailed'), color: 'error' })
  }
}

const iconOf = (item: DropdownMenuItem) => (item as MenuItem).webvueIcon
const menu = computed<MenuItem[][]>(() => [
  [
    { type: 'label' as const, label: me.value?.display_name ?? '' },
    ...(roleNames.value ? [{ type: 'label' as const, label: roleNames.value }] : []),
  ],
  [
    { type: 'label' as const, label: t('app.shell.language') },
    ...locales.value.map(language => ({
      type: 'checkbox' as const,
      label: language.name ?? language.code,
      checked: locale.value === language.code,
      onUpdateChecked: (checked: boolean) => {
        if (checked) void choose(language.code)
      },
    })),
  ],
  [
    { type: 'label' as const, label: t('app.shell.appearance') },
    ...modes.map(item => ({
      type: 'checkbox' as const,
      label: t(`app.shell.${item.value}`),
      webvueIcon: item.icon,
      checked: mode.value === item.value,
      onUpdateChecked: (checked: boolean) => { if (checked) setMode(item.value) },
    })),
  ],
  [
    { label: t('app.shell.signOut'), color: 'error' as const, webvueIcon: 'i-lucide-log-out', onSelect: () => { void leave() } },
  ],
])
</script>

<template>
  <header data-testid="shell-header" class="webvue-shell-header" :aria-label="t('app.shell.header')">
    <div class="webvue-shell-header-start">
      <AdminMobileNav :items="props.items" :active-id="props.activeId" />
      <ShellBreadcrumb :items="crumbs" />
      <UBadge color="neutral" variant="subtle" size="sm" class="min-w-0 shrink grow-0 overflow-hidden whitespace-nowrap" data-testid="vendor-console-badge">
        {{ t('app.shell.consoleBadge') }}
      </UBadge>
    </div>
    <div class="webvue-shell-header-actions">
      <UDropdownMenu
        :items="menu"
        :modal="false"
        :disabled="!hydrated"
        :content="{ align: 'end', sideOffset: 4, avoidCollisions: false, sticky: 'always', updatePositionStrategy: 'always' }"
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
          :aria-label="me ? `${t('app.shell.account')}: ${me.display_name}` : t('app.shell.account')"
        >
          <UAvatar size="sm" :text="initials" :alt="me?.display_name ?? t('app.shell.account')" />
          <span class="account-copy">
            <span class="account-name">{{ me?.display_name }}</span>
            <span class="account-role">{{ roleNames }}</span>
          </span>
        </UButton>
        <template #item-leading="{ item }">
          <UIcon v-if="iconOf(item)" :name="iconOf(item)!" class="webvue-shell-icon size-4.5 shrink-0" aria-hidden="true" />
        </template>
      </UDropdownMenu>
    </div>
  </header>
</template>
