<script setup lang="ts">
import { useEventListener, useMagicKeys, whenever } from '@vueuse/core'
import { useProjects } from '@/composables/useProjects'

const open = useState<boolean>('command-open', () => false)
const { me } = useMe()
const nav = computed(() => useNav(me.value?.role))
const { data: projects } = useProjects()
const keys = useMagicKeys()
whenever(() => keys['Meta+K']?.value || keys['Ctrl+K']?.value, () => { open.value = !open.value })

async function go(to: string) {
  open.value = false
  if (to === '/odoo') window.open(to, '_blank', 'noopener')
  else await navigateTo(to)
}

// Every row advertises a key, so the key has to do something. The palette opens
// with CommandInput focused; capture phase lets a bare shortcut jump instead of
// typing into the search box — but only while the box is still empty, so the
// same characters remain typeable once the user starts filtering. Modifier
// combinations stay untouched.
//
// The generated CommandInput (app/components/ui/command/CommandInput.vue)
// doesn't forward a search-term prop from Command/CommandDialog, so there is
// no `v-model:search-term` to read here. It does still accept an external
// `v-model` though: Vue merges the `v-model="query"` passed to it below with
// CommandInput's own internal `v-model="filterState.search"` via
// `mergeProps`, which fires both `update:modelValue` handlers on every
// keystroke, so `query` tracks the live filter text without any change to
// the generated component.
const query = ref('')
const shortcuts = computed(() => new Map(nav.value.map(item => [item.shortcut, item.to])))
useEventListener('keydown', (event: KeyboardEvent) => {
  if (!open.value || event.metaKey || event.ctrlKey || event.altKey) return
  if (query.value) return
  const to = shortcuts.value.get(event.key)
  if (!to) return
  event.preventDefault()
  event.stopPropagation()
  go(to)
}, { capture: true })
</script>

<template>
  <CommandDialog v-model:open="open">
    <CommandInput v-model="query" :placeholder="$t('nav.typeToNavigate')" />
    <CommandList>
      <CommandEmpty>{{ $t('app.noResults') }}</CommandEmpty>
      <CommandGroup :heading="$t('nav.goTo')">
        <CommandItem v-for="item in nav" :key="item.to" :value="$t(item.labelKey)" @select="go(item.to)">
          <component :is="item.icon" class="me-2 size-4" />
          <span>{{ $t(item.labelKey) }}</span>
          <CommandShortcut>{{ item.shortcut }}</CommandShortcut>
        </CommandItem>
      </CommandGroup>
      <CommandGroup v-if="projects?.length" :heading="$t('nav.projects')">
        <CommandItem v-for="p in projects" :key="p.id" :value="`${p.name} #${p.id}`" @select="go(`/projects/${p.id}`)">
          <span>{{ p.name }}</span>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
