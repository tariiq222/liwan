<script setup lang="ts">
import type { Component } from 'vue'
import type { ShellContextLink } from '@/composables/nav/shellModules'
import { contextLinkTestId, type ShellContextSection } from '@/composables/nav/sidebarModel'

// The floating context sidebar; its round toggle lives in the heading. Props only: AppSidebar derives what it
// shows from useShellModel(); an application's panel arrives as `panel`.
const props = defineProps<{
  title: string
  createLinks: ShellContextLink[]
  sections: ShellContextSection[]
  showNav: boolean
  counts: Record<string, number>
  preference?: 'auto' | 'open' | 'closed'
  expanded: boolean
  hydrated: boolean
  /** Collapsed by another layer: the toggle is inert until it lets go. */
  locked?: boolean
  panel: Component | null
  renderPanel: boolean
  panelWidth: 'default' | 'wide'
  motionKey: string
}>()
const emit = defineEmits<{ toggle: [] }>()
const { t } = useI18n()
const navigationId = `context-navigation-${useId()}`
const countId = (id: string) => `${navigationId}-count-${id}`
const countLabel = (value: number) => (value > 99 ? '99+' : String(value))
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
              :disabled="!props.hydrated || props.locked"
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

        <nav v-if="props.showNav" class="webvue-context-nav" data-fresh-navigation :aria-label="props.title">
          <div v-for="section in props.sections" :key="section.id" class="webvue-context-section">
            <h3 v-if="section.titleKey" class="webvue-context-section-title">{{ t(section.titleKey) }}</h3>
            <div v-for="link in section.links" :key="link.id" class="webvue-context-row">
              <UTooltip :text="t(link.labelKey)" :disabled="props.expanded">
                <UButton
                  :to="link.to"
                  color="neutral"
                  variant="ghost"
                  class="webvue-context-link"
                  :data-active="link.active"
                  :active="!!link.active"
                  :aria-current="link.active ? 'page' : undefined"
                  :aria-label="t(link.labelKey)"
                  :aria-describedby="props.counts[link.id] !== undefined ? countId(link.id) : undefined"
                  :data-testid="contextLinkTestId(link.id)"
                >
                  <template #leading>
                    <span class="webvue-context-chip" aria-hidden="true"><UIcon :name="link.icon" class="webvue-shell-icon size-4 shrink-0" /></span>
                  </template>
                  <span data-slot="label">{{ t(link.labelKey) }}</span>
                </UButton>
              </UTooltip>
              <span v-if="props.counts[link.id] !== undefined" :id="countId(link.id)" class="webvue-context-count">{{ countLabel(props.counts[link.id]!) }}</span>
            </div>
          </div>
        </nav>

        <div v-if="props.panel && props.renderPanel" v-show="props.expanded" class="webvue-context-panel">
          <component :is="props.panel" />
        </div>

      </div>
    </Transition>
  </aside>
</template>
