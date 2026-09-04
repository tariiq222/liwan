<script setup lang="ts">
import { LogOut } from 'lucide-vue-next'

const { t } = useI18n()
const { me } = useMe()
const { branding } = useBranding()
const { connected } = useBus()
const route = useRoute()
const nav = computed(() => useNav(me.value?.role))
const initials = computed(() => (me.value?.name ?? '?').trim().slice(0, 1))
// The nav links above are NuxtLink/<a> — they navigate natively and work
// fine before hydration, so they're left ungated. The account menu trigger
// below (opening to the logout item) is SSR-rendered with an attached
// listener and is racy the same way TaskToolbar's controls are; gate it.
const hydrated = useHydrated()

async function logout() {
  // body: {} so ofetch sets application/json — the endpoint rejects anything else.
  await $fetch('/api/auth/logout', { method: 'POST', body: {} })
  await refreshNuxtData('me')
  await navigateTo('/login')
}
</script>

<template>
  <Sidebar side="right" collapsible="icon">
    <SidebarHeader>
      <div class="flex items-center gap-2 px-2 py-1.5">
        <img v-if="branding" :src="branding.logo_url" :alt="branding.name" class="size-8 rounded-md object-contain" />
        <span class="truncate font-semibold group-data-[collapsible=icon]:hidden">{{ branding?.name ?? 'nasq' }}</span>
      </div>
    </SidebarHeader>

    <SidebarContent role="navigation">
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem v-for="item in nav" :key="item.to">
            <SidebarMenuButton as-child :is-active="route.path === item.to" :tooltip="$t(item.labelKey)">
              <NuxtLink v-if="item.to !== '/odoo'" :to="item.to">
                <component :is="item.icon" />
                <span>{{ $t(item.labelKey) }}</span>
              </NuxtLink>
              <a v-else :href="item.to" target="_blank" rel="noopener">
                <component :is="item.icon" />
                <span>{{ $t(item.labelKey) }}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
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
          <DropdownMenuItem @select="logout"><LogOut class="me-2 size-4" />{{ $t('nav.logout') }}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>
