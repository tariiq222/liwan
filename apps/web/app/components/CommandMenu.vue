<script setup lang="ts">
import { useMagicKeys, whenever } from '@vueuse/core'

const open = useState<boolean>('command-open', () => false)
const { me } = useMe()
const nav = computed(() => useNav(me.value?.role))
const keys = useMagicKeys()
whenever(() => keys['Meta+K']?.value || keys['Ctrl+K']?.value, () => { open.value = !open.value })

async function go(to: string) {
  open.value = false
  if (to === '/odoo') window.open(to, '_blank', 'noopener')
  else await navigateTo(to)
}
</script>

<template>
  <CommandDialog v-model:open="open">
    <CommandInput placeholder="اكتب للانتقال…" />
    <CommandList>
      <CommandEmpty>لا نتائج.</CommandEmpty>
      <CommandGroup heading="الانتقال إلى">
        <CommandItem v-for="item in nav" :key="item.to" :value="item.label" @select="go(item.to)">
          <component :is="item.icon" class="me-2 size-4" />
          <span>{{ item.label }}</span>
          <CommandShortcut>{{ item.shortcut }}</CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
