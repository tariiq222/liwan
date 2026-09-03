<script setup lang="ts">
import { useEventListener, useMagicKeys, whenever } from '@vueuse/core'

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

// Every row advertises a key, so the key has to do something. The palette opens
// with CommandInput focused; capture phase lets a bare shortcut jump instead of
// typing into the search box. Modifier combinations stay untouched.
const shortcuts = computed(() => new Map(nav.value.map(item => [item.shortcut, item.to])))
useEventListener('keydown', (event: KeyboardEvent) => {
  if (!open.value || event.metaKey || event.ctrlKey || event.altKey) return
  const to = shortcuts.value.get(event.key)
  if (!to) return
  event.preventDefault()
  event.stopPropagation()
  go(to)
}, { capture: true })
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
