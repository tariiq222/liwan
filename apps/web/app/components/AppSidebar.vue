<script setup lang="ts">
import { ChevronDown, LogOut, UserRound } from 'lucide-vue-next'
import { isNavPathActive } from '@/utils/accessPolicy'
import { useQueryClient } from '@tanstack/vue-query'
import { useSidebar } from '@/components/ui/sidebar/utils'
const queryClient = useQueryClient()
const { state, setOpenMobile } = useSidebar()

const { t, localeProperties } = useI18n()
const { me } = useMe()
const { branding } = useBranding()
const { connected } = useBus()
const route = useRoute()
const nav = computed(() => useNav(me.value))
const groups = computed(() => [
  { id: 'projects', labelKey: 'nav.projects' },
  { id: 'hr', labelKey: 'nav.humanResources' },
  { id: 'admin', labelKey: 'nav.systemAdministration' },
].map(group => ({ ...group, items: nav.value.filter(item => item.group === group.id) })).filter(group => group.items.length))
const standalone = computed(() => nav.value.filter(item => !item.group))
const openGroups = ref<Record<string, boolean>>({ projects: true, hr: true, admin: true })
const preferenceKey = computed(() => `nasq-nav:${me.value?.id ?? 'anonymous'}`)
onMounted(() => {
  try { const saved = sessionStorage.getItem(preferenceKey.value); if (saved) openGroups.value = { ...openGroups.value, ...JSON.parse(saved) } } catch { /* Optional preference. */ }
})
watch(() => route.path, () => {
  for (const group of groups.value) if (group.items.some(item => isActive(item.to))) openGroups.value[group.id] = true
})
function toggleGroup(id: string) {
  openGroups.value[id] = !openGroups.value[id]
  try { sessionStorage.setItem(preferenceKey.value, JSON.stringify(openGroups.value)) } catch { /* Navigation works without storage. */ }
}
const initials = computed(() => (me.value?.name ?? '?').trim().slice(0, 1))
const productName = computed(() => branding.value?.name ?? t('app.productName'))
function isActive(path: string) {
  return isNavPathActive(route.path, path)
}
// The nav links above are NuxtLink/<a> — they navigate natively and work
// fine before hydration, so they're left ungated. The account menu trigger
// below (opening to the logout item) is SSR-rendered with an attached
// listener and is racy the same way TaskToolbar's controls are; gate it.
const hydrated = useHydrated()

async function logout() {
  // body: {} so ofetch sets application/json — the endpoint rejects anything else.
  await $fetch('/api/auth/logout', { method: 'POST', body: {} })
  sessionStorage.removeItem(preferenceKey.value)
  await queryClient.cancelQueries()
  queryClient.clear()
  await refreshNuxtData('me')
  await navigateTo('/login')
}
</script>

<template>
  <Sidebar :side="localeProperties.dir === 'rtl' ? 'right' : 'left'" collapsible="icon">
    <SidebarHeader>
      <div class="flex items-center gap-2 px-2 py-1.5">
        <img v-if="branding" :src="branding.logo_url" :alt="branding.name" class="size-8 rounded-md object-contain" />
        <span v-else class="grid size-8 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">ن</span>
        <span class="truncate font-semibold group-data-[collapsible=icon]:hidden">{{ productName }}</span>
      </div>
    </SidebarHeader>

    <SidebarContent role="navigation" :aria-label="$t('nav.goTo')">
      <SidebarGroup v-for="group in groups" :key="group.id">
        <button type="button" class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs font-semibold text-muted-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden" :disabled="!hydrated" :aria-expanded="openGroups[group.id]" :aria-controls="`nav-group-${group.id}`" @click="toggleGroup(group.id)">
          <span>{{ $t(group.labelKey) }}</span><ChevronDown class="ms-auto size-3.5 transition-transform" :class="{ '-rotate-90': !openGroups[group.id] }" />
        </button>
        <SidebarMenu v-show="openGroups[group.id] || state === 'collapsed'" :id="`nav-group-${group.id}`">
          <SidebarMenuItem v-for="item in group.items" :key="item.to">
            <SidebarMenuButton as-child :is-active="isActive(item.to)" :tooltip="$t(item.labelKey)">
              <NuxtLink :to="item.to" @click="setOpenMobile(false)" :aria-current="isActive(item.to) ? 'page' : undefined"><component :is="item.icon" /><span>{{ $t(item.labelKey) }}</span></NuxtLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup v-if="standalone.length"><SidebarMenu><SidebarMenuItem v-for="item in standalone" :key="item.to"><SidebarMenuButton as-child :tooltip="$t(item.labelKey)"><a :href="item.to" target="_blank" rel="noopener"><component :is="item.icon" /><span>{{ $t(item.labelKey) }}</span></a></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <DropdownMenu>
        <DropdownMenuTrigger as-child :disabled="!hydrated">
          <SidebarMenuButton size="lg" :disabled="!hydrated">
            <div class="relative">
              <Avatar class="size-8 rounded-md"><AvatarFallback class="rounded-md">{{ initials }}</AvatarFallback></Avatar>
              <!--
                Client-only: the bus connection genuinely doesn't exist during
                SSR (bus.client.ts never runs there), so an SSR-rendered dot
                would always render "disconnected" and cause a hydration
                mismatch the instant the client connects.
              -->
              <ClientOnly>
                <span
                  class="absolute -bottom-0.5 -end-0.5 block size-2.5 rounded-full ring-2 ring-sidebar"
                  :class="connected ? 'bg-emerald-500' : 'bg-muted-foreground/50'"
                  :title="connected ? t('bus.connected') : t('bus.disconnected')"
                  :aria-label="connected ? t('bus.connected') : t('bus.disconnected')"
                  role="status"
                />
              </ClientOnly>
            </div>
            <div class="grid flex-1 text-start text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span class="truncate font-medium">{{ me?.name }}</span>
              <span class="truncate text-xs text-muted-foreground">{{ me?.email }}</span>
            </div>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" class="w-56">
          <DropdownMenuItem as-child><NuxtLink to="/account"><UserRound class="me-2 size-4" />{{ $t('nav.account') }}</NuxtLink></DropdownMenuItem>
          <DropdownMenuItem @select="logout"><LogOut class="me-2 size-4" />{{ $t('nav.logout') }}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>
