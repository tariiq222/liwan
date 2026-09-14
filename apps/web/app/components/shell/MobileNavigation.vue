<script setup lang="ts">
import type { SlideoverProps } from '@nuxt/ui'
import { useMediaQuery } from '@vueuse/core'
import SidebarCreateAction from '@/components/shell/SidebarCreateAction.vue'
import { useShellNavigation } from '@/composables/useShellNavigation'
import { hidePinnedNewProject, shellModules, visibleShellModules } from '@/composables/nav/shellModules'
import { activeShellModule, contextModuleFor } from '@/composables/nav/activeRoute'
import { createLinkTo } from '@/composables/nav/createActions'

const { t, te, localeProperties } = useI18n()
const menuTitle = computed(() => te('nav.navigation') ? t('nav.navigation') : t('nav.modules'))
const openMenuLabel = computed(() => te('nav.openMenu') ? t('nav.openMenu') : t('nav.toggleSidebar'))
const { me } = useMe()
const route = useRoute()
const router = useRouter()
const hydrated = useHydrated()
const open = ref(false)
const desktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const { module, contextLinks } = useShellNavigation(() => me.value)
const availableModules = computed(() => visibleShellModules(me.value))
const activeModule = computed(() => activeShellModule(route.path))
// `home` and `projects` share one projects sidebar heading (2026-09-11).
const linksModule = computed(() => contextModuleFor(activeModule.value))
const moduleDefinition = computed(() => shellModules.find(item => item.id === linksModule.value) ?? module.value)
const contextTitle = computed(() => moduleDefinition.value ? t(moduleDefinition.value.labelKey) : t('app.productName'))
const primaryLinks = computed(() => contextLinks.value)
// Pinned create actions first, then navigation — the same order as the desktop sidebar.
const orderedLinks = computed(() => [...primaryLinks.value.filter(link => link.pinned), ...primaryLinks.value.filter(link => !link.pinned)])
const createLinks = computed(() => orderedLinks.value.filter(link => link.pinned && !(link.id === 'new-project' && hidePinnedNewProject(route.path))))
const navigationLinks = computed(() => orderedLinks.value.filter(link => !link.pinned))

watch(desktop, value => { if (value) open.value = false })
watch(() => route.fullPath, () => { open.value = false })

function createTo(link: { id: string; to: import('vue-router').RouteLocationRaw }): import('vue-router').RouteLocationRaw {
  return createLinkTo(link, { path: route.path, fullPath: route.fullPath, query: route.query, params: route.params })
}

function closeIfCurrent(to: import('vue-router').RouteLocationRaw) {
  if (router.resolve(to).fullPath === route.fullPath) open.value = false
}

function moduleTarget(module: { id: string; to: string }) {
  return module.id === 'vendor' ? undefined : module.to
}

function onModuleActivate(module: { id: string; to: string }) {
  if (module.id === 'vendor' || router.resolve(module.to).fullPath === route.fullPath) open.value = false
}

const dialogContent = computed<NonNullable<SlideoverProps['content']> & { id: string }>(() => ({ id: 'mobile-navigation' }))
</script>

<template>
  <USlideover
    v-model:open="open"
    :side="localeProperties.dir === 'rtl' ? 'right' : 'left'"
    :title="menuTitle"
    :description="contextTitle"
    :content="dialogContent"
    :ui="{ content: 'nasq-mobile-menu', overlay: 'nasq-mobile-menu-overlay' }"
  >
    <UButton
      id="mobile-navigation-trigger"
      class="nasq-mobile-menu-trigger"
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
        <UIcon name="i-lucide-menu" class="nasq-shell-icon size-4.5 shrink-0" aria-hidden="true" />
      </template>
    </UButton>
    <template #body>
      <div>
        <nav :aria-label="t('nav.modules')" class="grid gap-2">
          <UButton
            v-for="item in availableModules"
            :key="item.id"
            :to="moduleTarget(item)"
            :href="item.id === 'vendor' ? item.to : undefined"
            :target="item.id === 'vendor' ? '_blank' : undefined"
            :rel="item.id === 'vendor' ? 'noopener' : undefined"
            color="neutral"
            variant="ghost"
            class="nasq-module-rail-link"
            :label="t(item.labelKey)"
            :aria-label="t(item.labelKey)"
            :aria-current="activeModule === item.id ? 'page' : undefined"
            :data-active="activeModule === item.id"
            :active="activeModule === item.id"
            @click="onModuleActivate(item)"
          >
            <template #leading>
              <UIcon :name="item.icon" class="nasq-shell-icon size-4.5 shrink-0" aria-hidden="true" />
            </template>
          </UButton>
        </nav>
        <USeparator class="my-6" />
        <h2 class="mb-3 font-semibold">{{ contextTitle }}</h2>
        <div v-if="createLinks.length" class="mb-3 grid gap-2">
          <SidebarCreateAction
            v-for="link in createLinks"
            :key="link.id"
            :to="createTo(link)"
            :label="t(link.labelKey)"
            :active="link.active"
            :test-id="`mobile-context-link-${link.id}`"
            @click="closeIfCurrent(createTo(link))"
          />
        </div>
        <nav v-if="navigationLinks.length" :aria-label="contextTitle" class="grid gap-2">
          <UButton
            v-for="link in navigationLinks"
            :key="link.id"
            :to="link.to"
            color="neutral"
            variant="ghost"
            class="nasq-context-link"
            :label="t(link.labelKey)"
            :aria-label="t(link.labelKey)"
            :aria-current="link.active ? 'page' : undefined"
            :data-active="link.active"
            :active="!!link.active"
            :data-testid="`mobile-context-link-${link.id}`"
            @click="closeIfCurrent(link.to)"
          >
            <template #leading>
              <UIcon :name="link.icon" class="nasq-shell-icon size-4.5 shrink-0" aria-hidden="true" />
            </template>
          </UButton>
        </nav>
      </div>
    </template>
  </USlideover>
</template>
