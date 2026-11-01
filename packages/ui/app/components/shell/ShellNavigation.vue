<script setup lang="ts">
import { createReusableTemplate } from '@vueuse/core'
import type { ShellNavigationItem, ShellNavigationLink, ShellQuickItem } from '../../types/shell'
import { useNavigationDisclosure, useNavigationPathDisclosure } from '../../composables/useNavigationDisclosure'
import ShellContextSubList from './ShellContextSubList.vue'
import ShellQuickViews from './ShellQuickViews.vue'
import BrandWordmark from '../shared/layout/BrandWordmark.vue'

const props = defineProps<{
  items: ShellNavigationItem[]
  activeId: string | null
  routeKey: string
  expanded: boolean
  /** The folded card is open over the page for now; the toggle then keeps it open. */
  overlay?: boolean
  hydrated: boolean
  homeTo: string
  title?: string
  hideBrand?: boolean
  preference?: 'auto' | 'open' | 'closed'
  locked?: boolean
  surface?: 'sidebar' | 'context' | 'drawer'
  showPanel?: boolean
  panelWidth?: 'default' | 'wide'
}>()
const emit = defineEmits<{ toggle: []; navigate: [item: ShellQuickItem] }>()
defineSlots<{ panel?: (props: { item: ShellNavigationItem }) => unknown }>()
const { t, localeProperties } = useI18n()
const menuId = `navigation-${useId()}`
const collapsed = computed(() => props.surface !== 'drawer' && !props.expanded)
const toggleLabel = computed(() => props.overlay ? 'nav.keepContextOpen' : collapsed.value ? 'nav.expandContext' : 'nav.collapseContext')
const hasChildren = (item: ShellNavigationItem) => !!(item.sections.length || item.views.length || item.actions.length || item.panel)
const ids = computed(() => props.items.filter(hasChildren).map(item => item.id))
const { openId, setOpen } = useNavigationDisclosure(toRef(props, 'activeId'), toRef(props, 'routeKey'), collapsed, ids)
const submenuState = computed(() => {
  const paths: string[][] = []
  let activePath: string[] = []
  const selected = (row: ShellNavigationLink): boolean => !!row.active || !!row.children?.some(selected)
  function visit(rows: ShellNavigationLink[], parent: string[], active: boolean) {
    for (const row of rows) {
      if (!row.children?.length) continue
      const path = [...parent, row.id]
      paths.push(path)
      if (active && selected(row) && path.length > activePath.length) activePath = path
      visit(row.children, path, active)
    }
  }
  for (const item of props.items) visit(item.sections.flatMap(section => section.items), [item.id], item.active)
  return { paths, activePath }
})
const { openPath, setOpen: setSubmenuOpen } = useNavigationPathDisclosure(computed(() => submenuState.value.activePath), toRef(props, 'routeKey'), collapsed, computed(() => submenuState.value.paths))
const childOpenPath = (itemId: string) => openPath.value[0] === itemId ? openPath.value.slice(1) : []
const panel = computed(() => props.showPanel && props.items.some(item => item.panel))
const prefix = computed(() => props.surface === 'drawer' ? 'mobile-' : '')
const [DefineRow, ReuseRow] = createReusableTemplate<{ item: ShellNavigationItem; disclosure: boolean }>()
const [DefineContent, ReuseContent] = createReusableTemplate<{ item: ShellNavigationItem; showPanel: boolean }>()
function navigate(item: ShellQuickItem) {
  if (collapsed.value && openId.value) setOpen(openId.value, false)
  emit('navigate', item)
}
</script>

<template>
  <DefineRow v-slot="{ item, disclosure }">
    <UButton
      :to="disclosure ? undefined : item.to"
      :type="disclosure ? 'button' : undefined"
      color="neutral"
      variant="ghost"
      class="liwan-context-link liwan-navigation-app"
      :disabled="disclosure && !props.hydrated"
      :data-testid="`${prefix}navigation-app-${item.id}`"
      :data-active="item.active"
      :active="item.active"
      :aria-label="item.label"
      :aria-current="!disclosure && item.active ? 'page' : undefined"
      :title="collapsed ? item.label : undefined"
      @click="!disclosure && navigate({ id: item.id, label: item.label, icon: item.icon, to: item.to })"
    >
      <template #leading><span class="liwan-context-chip" aria-hidden="true"><UIcon :name="item.icon" class="liwan-shell-icon size-4 shrink-0" /></span></template>
      <span data-slot="label">{{ item.label }}</span>
      <template v-if="disclosure && !collapsed" #trailing><UIcon name="i-lucide-chevron-down" class="liwan-navigation-chevron size-4 shrink-0" :class="{ 'rotate-180': openId === item.id }" aria-hidden="true" /></template>
    </UButton>
  </DefineRow>

  <DefineContent v-slot="{ item, showPanel }">
    <div class="liwan-navigation-children" :data-testid="collapsed && showPanel ? undefined : `${prefix}navigation-submenu-${item.id}`">
      <div v-if="item.panel && showPanel" class="liwan-navigation-panel"><slot name="panel" :item="item" /></div>
      <template v-else>
        <ShellContextSubList :label="item.label" :sections="item.sections" :collapsed="false" surface="drawer" :test-id-prefix="`${prefix}${item.id}-`" :open-path="childOpenPath(item.id)" :hydrated="props.hydrated" @disclose="(path, open) => setSubmenuOpen([item.id, ...path], open)" @navigate="navigate" />
        <ShellQuickViews :label="t('nav.quickViews')" :views-label="t('nav.quickViewsList')" :actions-label="t('nav.quickActionsList')" :views="item.views" :actions="item.actions" :collapsed="false" surface="drawer" :test-id-prefix="`${prefix}${item.id}-`" @navigate="navigate" />
      </template>
    </div>
  </DefineContent>

  <aside class="liwan-context-sidebar liwan-navigation" :data-testid="`${prefix}application-navigation`" :data-expanded="!collapsed" :data-overlay="props.overlay ? 'true' : undefined" :data-preference="props.preference" :data-surface="props.surface ?? 'sidebar'" :data-panel="panel ? 'true' : undefined" :data-panel-width="panel ? props.panelWidth : undefined" :aria-label="props.title ?? t('nav.modules')">
    <div v-if="props.surface !== 'drawer'" class="liwan-context-heading">
      <h2>{{ props.title ?? t('nav.apps') }}</h2>
      <UTooltip :text="t(toggleLabel)" :kbds="['[']">
        <UButton type="button" color="neutral" variant="ghost" square size="sm" class="liwan-context-toggle" data-testid="context-sidebar-toggle" :disabled="!props.hydrated || props.locked" :aria-expanded="!collapsed" :aria-label="t(toggleLabel)" aria-keyshortcuts="[" @click="emit('toggle')">
          <UIcon :name="props.overlay ? 'i-lucide-pin' : collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-left'" class="liwan-shell-icon" :class="{ 'rtl:-scale-x-100': !props.overlay }" aria-hidden="true" />
        </UButton>
      </UTooltip>
    </div>
    <nav :id="menuId" class="liwan-navigation-list" data-fresh-navigation :aria-label="props.title ?? t('nav.apps')">
      <template v-for="item in props.items" :key="item.id">
        <template v-if="hasChildren(item)">
          <UPopover v-if="collapsed" :open="openId === item.id" :content="{ side: localeProperties.dir === 'rtl' ? 'left' : 'right', align: 'start' }" @update:open="setOpen(item.id, $event)">
            <ReuseRow :item="item" :disclosure="true" />
            <template #content><div class="liwan-navigation-popup"><h2 class="liwan-sub-list-title">{{ item.label }}</h2><ReuseContent :item="item" :show-panel="false" /></div></template>
          </UPopover>
          <UCollapsible v-if="!collapsed || (item.panel && props.showPanel)" :class="{ hidden: collapsed }" :open="!collapsed && (props.surface === 'context' || openId === item.id)" :unmount-on-hide="!(item.panel && props.showPanel)" :disabled="!props.hydrated" @update:open="setOpen(item.id, $event)">
            <template v-if="!collapsed && props.surface !== 'context'" #default><ReuseRow :item="item" :disclosure="true" /></template>
            <template #content><ReuseContent :item="item" :show-panel="!!props.showPanel" /></template>
          </UCollapsible>
        </template>
        <ReuseRow v-else :item="item" :disclosure="false" />
      </template>
    </nav>
    <NuxtLink v-if="props.surface !== 'drawer' && !props.hideBrand" :to="props.homeTo" class="liwan-module-rail-brand" :aria-label="`${t('brand.name')} — ${t('nav.home')}`"><BrandWordmark size="md" :mark-only="collapsed" /></NuxtLink>
  </aside>
</template>
