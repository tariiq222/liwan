<script setup lang="ts">
import { Search } from 'lucide-vue-next'

const commandOpen = useState<boolean>('command-open', () => false)
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset>
      <header class="flex h-14 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <div class="flex-1" />
        <Button variant="outline" size="sm" class="gap-2 text-muted-foreground" @click="commandOpen = true">
          <Search class="size-4" />
          <span class="hidden sm:inline">بحث</span>
          <kbd class="pointer-events-none rounded border bg-muted px-1.5 font-mono text-[10px]">⌘K</kbd>
        </Button>
      </header>
      <main class="p-6">
        <slot />
      </main>
    </SidebarInset>
    <CommandMenu />
  </SidebarProvider>
</template>
