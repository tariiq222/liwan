<script setup lang="ts">
import { Search } from 'lucide-vue-next'

import { useEventListener } from '@vueuse/core'
const route = useRoute()
function openSearch() {
  if (route.path !== '/search') void navigateTo({ path: '/search', query: { returnTo: route.fullPath } })
}
useEventListener('keydown', (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch() }
})
// The toaster was hardcoded to rtl, so an `en` user got right-anchored toasts
// with mirrored padding. Follow the active locale's direction instead.
const { localeProperties } = useI18n()
const dir = computed(() => localeProperties.value.dir ?? 'ltr')
// SSR-rendered with an attached listener, racy the same way as the other
// controls documented in README's "SSR hydration and interactive controls".
const hydrated = useHydrated()
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset>
      <header class="flex h-14 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <div class="flex-1" />
        <Button variant="outline" size="sm" class="gap-2 text-muted-foreground" :disabled="!hydrated" @click="openSearch">
          <Search class="size-4" />
          <span class="hidden sm:inline">{{ $t('app.search') }}</span>
          <kbd class="pointer-events-none rounded border bg-muted px-1.5 font-mono text-[10px]">⌘K</kbd>
        </Button>
      </header>
      <main class="min-w-0 p-4 md:p-6">
        <slot />
      </main>
    </SidebarInset>

    <Toaster :dir="dir" />
  </SidebarProvider>
</template>
