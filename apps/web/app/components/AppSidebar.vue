<script setup lang="ts">
import { LogOut } from 'lucide-vue-next'

const { me } = useMe()
const { branding } = useBranding()
const route = useRoute()
const nav = computed(() => useNav(me.value?.role))
const initials = computed(() => (me.value?.name ?? '?').trim().slice(0, 1))

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
            <SidebarMenuButton as-child :is-active="route.path === item.to" :tooltip="item.label">
              <NuxtLink v-if="item.to !== '/odoo'" :to="item.to">
                <component :is="item.icon" />
                <span>{{ item.label }}</span>
              </NuxtLink>
              <a v-else :href="item.to" target="_blank" rel="noopener">
                <component :is="item.icon" />
                <span>{{ item.label }}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton size="lg">
            <Avatar class="size-8 rounded-md"><AvatarFallback class="rounded-md">{{ initials }}</AvatarFallback></Avatar>
            <div class="grid flex-1 text-start text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span class="truncate font-medium">{{ me?.name }}</span>
              <span class="truncate text-xs text-muted-foreground">{{ me?.email }}</span>
            </div>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" class="w-56">
          <DropdownMenuItem @select="logout"><LogOut class="me-2 size-4" />تسجيل الخروج</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>
