<script setup lang="ts">
import { LogOut, Palette, UserRound } from '@lucide/vue'
import { useQueryClient } from '@tanstack/vue-query'

const queryClient = useQueryClient()
const { t } = useI18n()
const { me } = useMe()
const { connected } = useBus()
const hydrated = useHydrated()

const initials = computed(() => (me.value?.name ?? '?').trim().slice(0, 1))
const navPreferenceKey = computed(() => `nasq-nav:${me.value?.id ?? 'anonymous'}`)

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST', body: {} })
  sessionStorage.removeItem(navPreferenceKey.value)
  await queryClient.cancelQueries()
  queryClient.clear()
  await refreshNuxtData('me')
  await navigateTo('/login')
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child :disabled="!hydrated">
      <button
        type="button"
        data-slot="header-account"
        class="header-account"
        :disabled="!hydrated"
        :aria-label="me?.name ? t('nav.account') + ': ' + me.name : t('nav.account')"
      >
        <span class="relative shrink-0">
          <Avatar class="size-[32px] border border-border bg-primary text-primary-foreground">
            <AvatarFallback class="bg-primary text-xs font-semibold text-primary-foreground">{{ initials }}</AvatarFallback>
          </Avatar>
          <ClientOnly>
            <span
              class="absolute -bottom-0.5 -end-0.5 block size-2.5 rounded-full ring-2 ring-background"
              :class="connected ? 'nasq-status-dot-success' : 'bg-muted-foreground/50'"
              :title="connected ? t('bus.connected') : t('bus.disconnected')"
              :aria-label="connected ? t('bus.connected') : t('bus.disconnected')"
              role="status"
            />
          </ClientOnly>
        </span>
        <span class="account-copy">
          <span class="account-name">{{ me?.name }}</span>
          <span class="account-role">{{ me?.company.name }}</span>
        </span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="approved-account-menu w-60">
      <DropdownMenuItem as-child>
        <NuxtLink to="/account"><UserRound aria-hidden="true" />{{ t('nav.account') }}</NuxtLink>
      </DropdownMenuItem>
      <DropdownMenuItem as-child>
        <NuxtLink to="/settings/appearance"><Palette aria-hidden="true" />{{ t('settings.appearance.title') }}</NuxtLink>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" @select="logout">
        <LogOut aria-hidden="true" />{{ t('nav.logout') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
