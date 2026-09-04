<script setup lang="ts">
import { Search } from 'lucide-vue-next'

const commandOpen = useState<boolean>('command-open', () => false)
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
        <Button variant="outline" size="sm" class="gap-2 text-muted-foreground" :disabled="!hydrated" @click="commandOpen = true">
          <Search class="size-4" />
          <span class="hidden sm:inline">{{ $t('app.search') }}</span>
          <kbd class="pointer-events-none rounded border bg-muted px-1.5 font-mono text-[10px]">⌘K</kbd>
        </Button>
      </header>
      <main class="p-6">
        <slot />
      </main>
    </SidebarInset>
    <CommandMenu />
    <Toaster :dir="dir" />
  </SidebarProvider>
</template>
