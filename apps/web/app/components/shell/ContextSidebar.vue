<script setup lang="ts">
import type { Component } from 'vue'
import type { ShellContextLink } from '@/composables/nav/shellModules'
import type { ShellContextSection } from '@/composables/nav/sidebarModel'
import ContextNavSections from './ContextNavSections.vue'

// The floating context sidebar; its round toggle lives in the heading. Props only: AppSidebar derives what it
// shows from useShellModel(); an application's panel arrives as `panel`. The fixed links stay in this card; the pages of
// the open section (sections with a heading) follow in their own card under it.
const props = defineProps<{
  title: string
  createLinks: ShellContextLink[]
  sections: ShellContextSection[]
  showNav: boolean
  counts: Record<string, number>
  preference?: 'auto' | 'open' | 'closed'
  expanded: boolean
  hydrated: boolean
  panel: Component | null
  renderPanel: boolean
  panelWidth: 'default' | 'wide'
  motionKey: string
}>()
const emit = defineEmits<{ toggle: [] }>()
const { t } = useI18n()
const navigationId = `context-navigation-${useId()}`
const fixedSections = computed(() => props.sections.filter(section => !section.titleKey))
const sectionPages = computed(() => props.sections.filter(section => section.titleKey))
</script>

<template>
  <aside
    data-testid="context-sidebar"
    class="webvue-context-sidebar"
    :data-expanded="props.expanded"
    :data-preference="props.preference"
    :data-panel="props.panel ? 'true' : undefined"
    :data-panel-width="props.panel ? props.panelWidth : undefined"
    :aria-label="t('nav.context')"
  >
    <Transition name="webvue-context" mode="out-in">
      <div :id="navigationId" :key="props.motionKey" class="webvue-context-sidebar-inner">
        <div class="webvue-context-heading">
          <h2>{{ props.title }}</h2>
          <div v-if="props.createLinks.length" class="webvue-context-create-actions">
            <UTooltip v-for="(link, index) in props.createLinks" :key="link.id" :text="t(link.labelKey)" :kbds="index === 0 ? ['C'] : undefined">
              <UButton
                :to="link.to"
                color="primary"
                variant="ghost"
                square
                size="sm"
                icon="i-lucide-plus"
                class="webvue-context-create-icon"
                :data-active="link.active"
                :aria-current="link.active ? 'page' : undefined"
                :aria-label="t(link.labelKey)"
                :aria-keyshortcuts="index === 0 ? 'c' : undefined"
                :data-testid="`context-link-${link.id}`"
              />
            </UTooltip>
          </div>
          <UTooltip :text="t(props.expanded ? 'nav.collapseContext' : 'nav.expandContext')" :kbds="['[']">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              square
              size="sm"
              class="webvue-context-toggle"
              data-testid="context-sidebar-toggle"
              :disabled="!props.hydrated"
              :aria-expanded="props.expanded"
              :aria-controls="navigationId"
              aria-keyshortcuts="["
              :aria-label="t(props.expanded ? 'nav.collapseContext' : 'nav.expandContext')"
              @click="emit('toggle')"
            >
              <template #leading>
                <UIcon :name="props.expanded ? 'i-lucide-chevron-left' : 'i-lucide-chevron-right'" class="webvue-shell-icon shrink-0 rtl:-scale-x-100" aria-hidden="true" />
              </template>
            </UButton>
          </UTooltip>
        </div>

        <nav v-if="props.showNav && fixedSections.length" class="webvue-context-nav" data-fresh-navigation :aria-label="props.title">
          <ContextNavSections :sections="fixedSections" :counts="props.counts" :expanded="props.expanded" :count-prefix="navigationId" />
        </nav>

        <div v-if="props.panel && props.renderPanel" v-show="props.expanded" class="webvue-context-panel">
          <component :is="props.panel" />
        </div>

      </div>
    </Transition>
  </aside>
  <nav
    v-if="props.showNav && sectionPages.length"
    data-testid="context-section-pages"
    class="webvue-context-sidebar webvue-context-nav webvue-context-section-pages"
    :data-expanded="props.expanded"
    :data-preference="props.preference"
    data-fresh-navigation
    :aria-label="t(sectionPages[0]!.titleKey!)"
  >
    <ContextNavSections :sections="sectionPages" :counts="props.counts" :expanded="props.expanded" :count-prefix="navigationId" />
  </nav>
</template>
