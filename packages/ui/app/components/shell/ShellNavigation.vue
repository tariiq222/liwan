<script setup lang="ts">
import { createReusableTemplate } from '@vueuse/core'
import type { ShellNavigationItem, ShellQuickItem } from '../../types/shell'
import { useNavigationDisclosure } from '../../composables/useNavigationDisclosure'
import ShellContextSubList from './ShellContextSubList.vue'
import ShellQuickViews from './ShellQuickViews.vue'
import BrandWordmark from '../shared/layout/BrandWordmark.vue'

const props = defineProps<{
  items: ShellNavigationItem[]
  activeId: string | null
  routeKey: string
  expanded: boolean
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
const contextItem = computed(() => props.surface === 'context' ? props.items[0] : undefined)
const menuId = `navigation-${useId()}`
const collapsed = computed(() => props.surface !== 'drawer' && !props.expanded)
const hasChildren = (item: ShellNavigationItem) => !!(item.sections.length || item.views.length || item.actions.length || item.panel)
const ids = computed(() => props.items.filter(hasChildren).map(item => item.id))
const { openId, setOpen } = useNavigationDisclosure(toRef(props, 'activeId'), toRef(props, 'routeKey'), collapsed, ids)
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
      class="webvue-context-link webvue-navigation-app"
      :disabled="disclosure && !props.hydrated"
      :data-testid="`${prefix}navigation-app-${item.id}`"
      :data-active="item.active"
      :active="item.active"
      :aria-label="item.label"
      :aria-current="!disclosure && item.active ? 'page' : undefined"
      :title="collapsed ? item.label : undefined"
      @click="!disclosure && navigate({ id: item.id, label: item.label, icon: item.icon, to: item.to })"
    >
      <template #leading><span class="webvue-context-chip" aria-hidden="true"><UIcon :name="item.icon" class="webvue-shell-icon size-4 shrink-0" /></span></template>
      <span data-slot="label">{{ item.label }}</span>
      <template v-if="disclosure && !collapsed" #trailing><UIcon name="i-lucide-chevron-down" class="webvue-navigation-chevron size-4 shrink-0" :class="{ 'rotate-180': openId === item.id }" aria-hidden="true" /></template>
    </UButton>
  </DefineRow>

  <DefineContent v-slot="{ item, showPanel }">
    <div class="webvue-navigation-children" :data-testid="collapsed && showPanel ? undefined : `${prefix}navigation-submenu-${item.id}`">
      <div v-if="item.panel && showPanel" class="webvue-navigation-panel"><slot name="panel" :item="item" /></div>
      <template v-else>
        <ShellContextSubList :label="item.label" :sections="item.sections" :collapsed="false" surface="drawer" :test-id-prefix="`${prefix}${item.id}-`" @navigate="navigate" />
        <ShellQuickViews :label="t('nav.quickViews')" :views-label="t('nav.quickViewsList')" :actions-label="t('nav.quickActionsList')" :views="item.views" :actions="item.actions" :collapsed="false" surface="drawer" :test-id-prefix="`${prefix}${item.id}-`" @navigate="navigate" />
      </template>
    </div>
  </DefineContent>

  <aside class="webvue-context-sidebar webvue-navigation" :data-testid="`${prefix}application-navigation`" :data-expanded="!collapsed" :data-preference="props.preference" :data-surface="props.surface ?? 'sidebar'" :data-panel="panel ? 'true' : undefined" :data-panel-width="panel ? props.panelWidth : undefined" :aria-label="props.title ?? t('nav.modules')">
    <div v-if="props.surface !== 'drawer'" class="webvue-context-heading">
      <h2>
        <UButton v-if="contextItem && !collapsed" type="button" color="neutral" variant="ghost" class="webvue-navigation-app webvue-context-title" :data-testid="`navigation-app-${contextItem.id}`" :aria-label="props.title ?? contextItem.label" :aria-expanded="openId === contextItem.id" :aria-controls="menuId" :disabled="!props.hydrated" @click="setOpen(contextItem.id, openId !== contextItem.id)">
          {{ props.title ?? contextItem.label }}
          <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0" :class="{ 'rotate-180': openId === contextItem.id }" aria-hidden="true" />
        </UButton>
        <template v-else>{{ props.title ?? t('nav.apps') }}</template>
      </h2>
      <UTooltip :text="t(collapsed ? 'nav.expandContext' : 'nav.collapseContext')" :kbds="['[']">
        <UButton type="button" color="neutral" variant="ghost" square size="sm" class="webvue-context-toggle" data-testid="context-sidebar-toggle" :disabled="!props.hydrated || props.locked" :aria-expanded="!collapsed" :aria-label="t(collapsed ? 'nav.expandContext' : 'nav.collapseContext')" aria-keyshortcuts="[" @click="emit('toggle')">
          <UIcon :name="collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-left'" class="webvue-shell-icon rtl:-scale-x-100" aria-hidden="true" />
        </UButton>
      </UTooltip>
    </div>
    <nav :id="menuId" class="webvue-navigation-list" data-fresh-navigation :aria-label="props.title ?? t('nav.apps')">
      <template v-for="item in props.items" :key="item.id">
        <template v-if="hasChildren(item)">
          <UPopover v-if="collapsed" :open="openId === item.id" :content="{ side: localeProperties.dir === 'rtl' ? 'left' : 'right', align: 'start' }" @update:open="setOpen(item.id, $event)">
            <ReuseRow :item="item" :disclosure="true" />
            <template #content><div class="webvue-navigation-popup"><h2 class="webvue-sub-list-title">{{ item.label }}</h2><ReuseContent :item="item" :show-panel="false" /></div></template>
          </UPopover>
          <UCollapsible v-if="!collapsed || (item.panel && props.showPanel)" :class="{ hidden: collapsed }" :open="!collapsed && openId === item.id" :unmount-on-hide="!(item.panel && props.showPanel)" :disabled="!props.hydrated" @update:open="setOpen(item.id, $event)">
            <template v-if="!collapsed && props.surface !== 'context'" #default><ReuseRow :item="item" :disclosure="true" /></template>
            <template #content><ReuseContent :item="item" :show-panel="!!props.showPanel" /></template>
          </UCollapsible>
        </template>
        <ReuseRow v-else :item="item" :disclosure="false" />
      </template>
    </nav>
    <NuxtLink v-if="props.surface !== 'drawer' && !props.hideBrand" :to="props.homeTo" class="webvue-module-rail-brand" :aria-label="`${t('brand.name')} — ${t('nav.home')}`"><BrandWordmark size="md" :mark-only="collapsed" /></NuxtLink>
  </aside>
</template>
