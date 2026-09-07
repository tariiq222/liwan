<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'
import { isNavPathActive } from '@/utils/accessPolicy'
import { useSidebar } from '@/components/ui/sidebar/utils'
const { state, setOpenMobile } = useSidebar()

const { t, localeProperties } = useI18n()
const { me } = useMe()
const { branding } = useBranding()
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
const productName = computed(() => branding.value?.name ?? t('app.productName'))
function isActive(path: string) {
  return isNavPathActive(route.path, path)
}
const hydrated = useHydrated()
</script>

<template>
  <Sidebar :side="localeProperties.dir === 'rtl' ? 'right' : 'left'" collapsible="icon">
    <SidebarHeader>
      <div class="flex items-center gap-2">
        <img v-if="branding" :src="branding.logo_url" :alt="branding.name" class="size-9 shrink-0 rounded-lg object-contain" />
        <span v-else class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">ن</span>
        <span class="truncate text-base font-semibold group-data-[collapsible=icon]:hidden">{{ productName }}</span>
      </div>
    </SidebarHeader>

    <SidebarContent role="navigation" :aria-label="$t('nav.goTo')">
      <SidebarGroup v-for="group in groups" :key="group.id">
        <button type="button" class="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden" :disabled="!hydrated" :aria-expanded="openGroups[group.id]" :aria-controls="`nav-group-${group.id}`" @click="toggleGroup(group.id)">
          <span>{{ $t(group.labelKey) }}</span><ChevronDown class="ms-auto transition-transform" :class="{ '-rotate-90': !openGroups[group.id] }" />
        </button>
        <SidebarMenu v-show="openGroups[group.id] || state === 'collapsed'" :id="`nav-group-${group.id}`">
          <SidebarMenuItem v-for="item in group.items" :key="item.to">
            <SidebarMenuButton as-child :is-active="isActive(item.to)" :tooltip="$t(item.labelKey)" class="h-10 px-3 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-[32px]! group-data-[collapsible=icon]:p-1.5!">
              <NuxtLink :to="item.to" @click="setOpenMobile(false)" :aria-current="isActive(item.to) ? 'page' : undefined"><component :is="item.icon" /><span>{{ $t(item.labelKey) }}</span></NuxtLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup v-if="standalone.length"><SidebarMenu><SidebarMenuItem v-for="item in standalone" :key="item.to"><SidebarMenuButton as-child :tooltip="$t(item.labelKey)"><a :href="item.to" target="_blank" rel="noopener"><component :is="item.icon" /><span>{{ $t(item.labelKey) }}</span></a></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup>
    </SidebarContent>

    <SidebarRail />
  </Sidebar>
</template>
