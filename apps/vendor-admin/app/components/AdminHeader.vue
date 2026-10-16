<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ShellRailItem } from '@nasq/ui/app/types/shell'
import type { AppearanceMode } from '@/composables/useAppearance'
import { usePageHeaderTitle } from '@nasq/ui/app/composables/usePageHeader'
import { isLocaleCode, LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from '@/utils/localePreference'

// The 48px neutral header: mobile menu, breadcrumb, the console badge that marks this as the
// vendor console, and the account menu (language, appearance, sign-out).
const props = defineProps<{ items: ShellRailItem[], activeId: string | null, mode: AppearanceMode }>()
const emit = defineEmits<{ 'update:mode': [mode: AppearanceMode] }>()
const { t, te, locale, setLocale } = useI18n()
const { me, signOut } = useAdminSession()
const hydrated = useHydrated()
const pageTitle = usePageHeaderTitle()
const localeCookie = useCookie<string | null>(LOCALE_COOKIE, { default: () => null, ...LOCALE_COOKIE_OPTIONS })

const languages = [{ code: 'ar', name: 'العربية' }, { code: 'en', name: 'English' }] as const
const modes = [{ value: 'light', icon: 'i-lucide-sun' }, { value: 'dark', icon: 'i-lucide-moon' }] as const
type MenuItem = DropdownMenuItem & { nasqIcon?: string }

const initials = computed(() => Array.from((me.value?.display_name ?? '?').trim())[0] ?? '?')
const roleNames = computed(() => (me.value?.roles ?? []).map(role => (te(`app.shell.roles.${role}`) ? t(`app.shell.roles.${role}`) : role)).join('، '))
const section = computed(() => props.items.find(item => item.id === props.activeId))
// The page registers its title after the server rendered the header; show it only once hydrated so both renders match.
const crumbs = computed(() => {
  const label = section.value ? t(section.value.labelKey) : null
  const title = hydrated.value ? pageTitle.value : null
  const trail = [] as { label: string, to?: string, active?: boolean }[]
  if (label && section.value) trail.push({ label, to: title && title !== label ? section.value.to : undefined })
  if (title && title !== label) trail.push({ label: title })
  return trail.map((crumb, index) => ({ ...crumb, active: index === trail.length - 1 }))
})

const iconOf = (item: DropdownMenuItem) => (item as MenuItem).nasqIcon
const menu = computed<MenuItem[][]>(() => [
  [
    { type: 'label' as const, label: me.value?.display_name ?? '' },
    ...(roleNames.value ? [{ type: 'label' as const, label: roleNames.value }] : []),
  ],
  [
    { type: 'label' as const, label: t('app.shell.language') },
    ...languages.map(language => ({
      type: 'checkbox' as const,
      label: language.name,
      checked: locale.value === language.code,
      onUpdateChecked: (checked: boolean) => {
        if (!checked || !isLocaleCode(language.code)) return
        localeCookie.value = language.code
        void setLocale(language.code)
      },
    })),
  ],
  [
    { type: 'label' as const, label: t('app.shell.appearance') },
    ...modes.map(mode => ({
      type: 'checkbox' as const,
      label: t(`app.shell.${mode.value}`),
      nasqIcon: mode.icon,
      checked: props.mode === mode.value,
      onUpdateChecked: (checked: boolean) => { if (checked) emit('update:mode', mode.value) },
    })),
  ],
  [
    { label: t('app.shell.signOut'), color: 'error' as const, nasqIcon: 'i-lucide-log-out', onSelect: () => { void signOut() } },
  ],
])
</script>

<template>
  <header data-testid="shell-header" class="nasq-shell-header" :aria-label="t('app.shell.header')">
    <div class="nasq-shell-header-start">
      <AdminMobileNav :items="props.items" :active-id="props.activeId" />
      <UBreadcrumb v-if="crumbs.length" :items="crumbs" :aria-label="t('app.shell.breadcrumb')" data-testid="shell-breadcrumb" class="nasq-shell-breadcrumb" />
      <UBadge color="neutral" variant="subtle" size="sm" class="nasq-shell-console-badge" data-testid="vendor-console-badge">
        {{ t('app.shell.consoleBadge') }}
      </UBadge>
    </div>
    <div class="nasq-shell-header-actions">
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
          <UIcon v-if="iconOf(item)" :name="iconOf(item)!" class="nasq-shell-icon size-4.5 shrink-0" aria-hidden="true" />
        </template>
      </UDropdownMenu>
    </div>
  </header>
</template>
