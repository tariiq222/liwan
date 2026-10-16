<script setup lang="ts">
import type { SlideoverProps } from '@nuxt/ui'
import { useMediaQuery } from '@vueuse/core'
import type { RouteLocationRaw } from 'vue-router'
import SidebarCreateAction from '@/components/shell/SidebarCreateAction.vue'
import type { ShellContextLink } from '@/composables/nav/shellModules'
import type { ShellRailItem } from '@webvue/ui/app/types/shell'
import type { ShellContextSection } from '@/composables/nav/sidebarModel'

// The one mobile drawer (< 768px): modules, then the current module's create
// actions and sections. Props only; ShellHeader derives them from useShellModel().
const props = defineProps<{
  modules: ShellRailItem[]
  activeId: string | null
  title: string
  createLinks: ShellContextLink[]
  sections: ShellContextSection[]
}>()
const open = defineModel<boolean>('open', { default: false })
const { t, te, localeProperties } = useI18n()
const route = useRoute()
const router = useRouter()
const hydrated = useHydrated()
const desktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const menuTitle = computed(() => te('nav.navigation') ? t('nav.navigation') : t('nav.modules'))
const openMenuLabel = computed(() => te('nav.openMenu') ? t('nav.openMenu') : t('nav.toggleSidebar'))
const dialogContent = computed<NonNullable<SlideoverProps['content']> & { id: string }>(() => ({ id: 'mobile-navigation' }))

watch(desktop, value => { if (value) open.value = false })
watch(() => route.fullPath, () => { open.value = false })

function closeIfCurrent(to: RouteLocationRaw) {
  if (router.resolve(to).fullPath === route.fullPath) open.value = false
}

function onModuleActivate(item: ShellRailItem) {
  if (router.resolve(item.to).fullPath === route.fullPath) open.value = false
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :side="localeProperties.dir === 'rtl' ? 'right' : 'left'"
    :title="menuTitle"
    :description="props.title"
    :content="dialogContent"
    :ui="{ content: 'webvue-mobile-menu', overlay: 'webvue-mobile-menu-overlay' }"
  >
    <UButton
      id="mobile-navigation-trigger"
      class="webvue-mobile-menu-trigger"
      type="button"
      color="neutral"
      variant="ghost"
      square
      data-testid="mobile-navigation-trigger"
      aria-controls="mobile-navigation"
      :aria-expanded="open"
      :aria-label="openMenuLabel"
      :disabled="!hydrated"
    >
      <template #leading>
        <UIcon name="i-lucide-menu" class="webvue-shell-icon size-4.5 shrink-0" aria-hidden="true" />
      </template>
    </UButton>
    <template #body>
      <nav data-fresh-navigation :aria-label="t('nav.modules')" class="webvue-mobile-section">
        <UButton
          v-for="item in props.modules"
          :key="item.id"
          :to="item.to"
          color="neutral"
          variant="ghost"
          class="webvue-context-link"
          :data-active="props.activeId === item.id"
          :active="props.activeId === item.id"
          :aria-current="props.activeId === item.id ? 'page' : undefined"
          :aria-label="t(item.labelKey)"
          @click="onModuleActivate(item)"
        >
          <template #leading>
            <UIcon :name="item.icon" class="webvue-shell-icon size-4.5 shrink-0" aria-hidden="true" />
          </template>
          <span data-slot="label">{{ t(item.labelKey) }}</span>
        </UButton>
      </nav>
      <USeparator class="my-4" />
      <h2 class="webvue-mobile-title">{{ props.title }}</h2>
      <div v-if="props.createLinks.length" class="webvue-mobile-section">
        <SidebarCreateAction
          v-for="link in props.createLinks"
          :key="link.id"
          :to="link.to"
          :label="t(link.labelKey)"
          :active="link.active"
          :test-id="`mobile-context-link-${link.id}`"
          @click="closeIfCurrent(link.to)"
        />
      </div>
      <nav data-fresh-navigation v-if="props.sections.length" :aria-label="props.title" class="webvue-mobile-section">
        <template v-for="section in props.sections" :key="section.id">
          <h3 v-if="section.titleKey" class="webvue-context-section-title">{{ t(section.titleKey) }}</h3>
          <UButton
            v-for="link in section.links"
            :key="link.id"
            :to="link.to"
            color="neutral"
            variant="ghost"
            class="webvue-context-link"
            :aria-label="t(link.labelKey)"
            :aria-current="link.active ? 'page' : undefined"
            :data-active="link.active"
            :active="!!link.active"
            :data-testid="`mobile-context-link-${link.id}`"
            @click="closeIfCurrent(link.to)"
          >
            <template #leading>
              <UIcon :name="link.icon" class="webvue-shell-icon size-4.5 shrink-0" aria-hidden="true" />
            </template>
            <span data-slot="label">{{ t(link.labelKey) }}</span>
          </UButton>
        </template>
      </nav>
    </template>
  </USlideover>
</template>
