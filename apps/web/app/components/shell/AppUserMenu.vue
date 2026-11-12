<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { useQuery } from '@tanstack/vue-query'
import { useAppearance } from '@/composables/useAppearance'
import { useLocaleChoice } from '@/composables/useLocaleChoice'
import { useSignOut } from '@/composables/useSignOut'
import { useSwitchCompany } from '@/composables/useSwitchCompany'
import { companySwitching } from '@/utils/companySwitch'
import { personalAction, personalEntries } from '@/composables/nav/personalModel'

// The user at the far end of the top bar: avatar (with the live-connection dot), name, first role and a chevron. The menu
// holds the employee card, the person's own services (only when the account is linked to an employee record; each
// entry is declared by its application through `personal` and filtered by the same permission and feature checks as
// the /account hub), a quick leave request, the account page, the appearance and language switches and sign out.
// «المزيد» opens the existing /account hub. Not offered because the product has no support for them: a presence status,
// per-user notification preferences and an automatic (follow the system) appearance. A person who belongs to more than
// one company of the tenant also gets the list of them under the card: the working one is marked, another one switches
// the whole session to it.
const { t, locale } = useI18n()
const { me } = useMe()
const { $api } = useApi()
const { connected } = useBus()
const hydrated = useHydrated()
const toast = useToast()
const signOut = useSignOut()
const switchCompany = useSwitchCompany()
const { mode, setMode } = useAppearance()
const { languages, choose } = useLocaleChoice()

const open = ref(false)
const name = computed(() => me.value?.name ?? '')
const initial = computed(() => Array.from(name.value.trim())[0]?.toLocaleUpperCase() ?? '?')
// The person's first role names them under their name; a person without one shows the name alone.
const roleName = computed(() => {
  const role = me.value?.roles?.[0]
  return role ? role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar : undefined
})
const label = computed(() => name.value ? `${t('nav.userMenu.label')}: ${name.value}` : t('nav.userMenu.label'))

// The employee card: the profile entry's own summary (job title and department), loaded when the menu opens.
const entries = computed(() => personalEntries(me.value))
const profileEntry = computed(() => entries.value.find(entry => entry.section === 'profile' && entry.summary))
const profile = useQuery({
  queryKey: computed(() => [...(profileEntry.value?.summary?.queryKey ?? ['user-menu']), 'user-menu', me.value?.company.id, me.value?.id, locale.value]),
  enabled: computed(() => hydrated.value && open.value && !!me.value && !!profileEntry.value),
  queryFn: ({ signal }) => profileEntry.value!.summary!.load((url, options) => $api(url, { ...options, signal }), t),
  staleTime: 5 * 60_000,
})
const employeeCaption = computed(() => profile.data.value?.value ? profile.data.value.caption : undefined)
const linked = computed(() => !!profile.data.value?.value)
const SERVICE_SECTIONS = ['profile', 'leave', 'pay', 'schedule', 'documents', 'requests'] as const
const services = computed(() => SERVICE_SECTIONS.flatMap(section => entries.value.filter(entry => entry.section === section).slice(0, 1)))
const leaveAction = computed(() => {
  const leave = entries.value.find(entry => entry.section === 'leave')
  return leave ? personalAction(leave, me.value) : null
})

const appearanceItems = computed(() => [
  { value: 'light', label: t('nav.userMenu.light'), icon: 'i-lucide-sun' },
  { value: 'dark', label: t('nav.userMenu.dark'), icon: 'i-lucide-moon' },
])
const languageItems = computed(() => languages.map(language => ({ value: language.code, label: language.name })))
const keepOpen = (event: Event) => event.preventDefault()

async function leave() {
  if (!(await signOut())) toast.add({ title: t('account.logoutFailed'), color: 'error' })
}

const companies = computed(() => me.value?.companies ?? [])
async function switchTo(companyId: number) {
  try {
    await switchCompany(companyId)
  } catch (cause) {
    toast.add({ title: cause instanceof Error ? cause.message : t('errors.generic'), color: 'error' })
  }
}

const items = computed<DropdownMenuItem[][]>(() => [
  [{ slot: 'employee', onSelect: keepOpen }],
  ...(companies.value.length > 1 ? [[
    { type: 'label' as const, label: t('nav.userMenu.company') },
    // The working company is a checked item: it stays reachable by keyboard and is announced as checked, and selecting it does nothing.
    ...companies.value.map(company => company.id === me.value?.company.id
      ? { type: 'checkbox' as const, label: company.name, icon: 'i-lucide-building-2', checked: true, onSelect: keepOpen }
      : { label: company.name, icon: 'i-lucide-building-2', disabled: companySwitching.value, onSelect: () => { void switchTo(company.id) } }),
  ]] : []),
  ...(linked.value && services.value.length ? [[
    { type: 'label' as const, label: t('nav.userMenu.services') },
    ...services.value.map(entry => ({ label: t(entry.labelKey), icon: entry.icon, to: entry.to })),
    { label: t('nav.userMenu.more'), icon: 'i-lucide-layout-grid', to: '/account' },
  ]] : []),
  ...(linked.value && leaveAction.value ? [[{ label: t(leaveAction.value.labelKey), icon: leaveAction.value.icon, to: leaveAction.value.to }]] : []),
  [{ label: t('nav.userMenu.accountPassword'), icon: 'i-lucide-user-round', to: '/account/settings' }],
  [{ slot: 'appearance', onSelect: keepOpen }, { slot: 'language', onSelect: keepOpen }],
  [{ label: t('nav.logout'), icon: 'i-lucide-log-out', color: 'error', onSelect: () => { void leave() } }],
])
</script>

<template>
  <UDropdownMenu
    v-model:open="open"
    :items="items"
    :modal="false"
    :disabled="!hydrated"
    :content="{ align: 'end', sideOffset: 8 }"
    :ui="{ content: 'approved-account-menu min-w-64' }"
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
    <template #employee>
      <div class="flex min-w-0 items-center gap-3 py-1" data-testid="user-menu-employee">
        <span class="grid size-10 shrink-0 place-items-center rounded-tile bg-(--liwan-ink) text-(--liwan-on-ink) font-semibold" aria-hidden="true">{{ initial }}</span>
        <span class="grid min-w-0">
          <span class="truncate text-sm font-semibold text-highlighted">{{ name }}</span>
          <span v-if="employeeCaption || roleName" class="truncate text-xs text-muted">{{ employeeCaption || roleName }}</span>
        </span>
      </div>
    </template>
    <template #appearance>
      <div class="flex items-center justify-between gap-3 py-1" data-testid="user-menu-appearance">
        <span class="text-sm text-toned">{{ t('nav.userMenu.appearance') }}</span>
        <SharedSegmentedControl :model-value="mode" :items="appearanceItems" :label="t('nav.userMenu.appearance')" @update:model-value="setMode($event === 'dark' ? 'dark' : 'light')" />
      </div>
    </template>
    <template #language>
      <div class="flex items-center justify-between gap-3 py-1" data-testid="user-menu-language">
        <span class="text-sm text-toned">{{ t('nav.language') }}</span>
        <SharedSegmentedControl :model-value="locale" :items="languageItems" :label="t('nav.language')" @update:model-value="choose($event as 'ar' | 'en')" />
      </div>
    </template>
  </UDropdownMenu>
</template>
