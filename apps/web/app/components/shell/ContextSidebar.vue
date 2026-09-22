<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import ConversationList from '@/components/chat/ConversationList.vue'
import { useContextSidebar, useShellNavigation } from '@/composables/useShellNavigation'
import { hidePinnedNewProject, shellModules } from '@/composables/nav/shellModules'
import { activeShellModule, contextModuleFor } from '@/composables/nav/activeRoute'
import { createLinkTo } from '@/composables/nav/createActions'
import { parseChatListRoute, serializeChatListRoute, type ChatListRoute } from '@/utils/chatState'

const { t, localeProperties } = useI18n()
const { me } = useMe()
const workspaceIdentity = useWorkspaceIdentity()
const route = useRoute()
const router = useRouter()
const { module, projectId, project, contextLinks } = useShellNavigation(workspaceIdentity)
const { expanded, hydrated, toggle } = useContextSidebar()
const navigationId = `context-navigation-${useId()}`
const activeModule = computed(() => activeShellModule(route.path))
// `home` and `projects` share one projects sidebar with one heading and one motion key (2026-09-11).
const linksModule = computed(() => contextModuleFor(activeModule.value))
const isProjectsArea = computed(() => linksModule.value === 'projects')
const moduleDefinition = computed(() => shellModules.find(item => item.id === linksModule.value) ?? module.value)
const contextTitle = computed(() => moduleDefinition.value ? t(moduleDefinition.value.labelKey) : t('app.productName'))
const isProject = computed(() => !!projectId.value && activeModule.value === 'projects')
const { remember } = useProjectWorkspaceMemory()
watch([() => route.fullPath, () => project.data.value, () => me.value, hydrated], () => {
  if (isProject.value && project.data.value?.id === projectId.value && !project.error.value) remember(route.path, route.query)
}, { immediate: true })
const isChat = computed(() => activeModule.value === 'chat')
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const routeState = computed(() => parseChatListRoute(route.query))
const selectedConversationId = computed(() => {
  const match = route.path.match(/^\/chat\/(\d+)(?:\/|$)/)
  const id = Number(match?.[1])
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
})
const primaryLinks = computed(() => contextLinks.value)
const moduleLinks = computed(() => (isChat.value && isDesktop.value && expanded.value
  ? primaryLinks.value.filter(item => item.id === 'new-chat')
  : primaryLinks.value))
// Pinned create actions first, then navigation — the same order as the mobile menu.
const orderedLinks = computed(() => [...moduleLinks.value.filter(link => link.pinned), ...moduleLinks.value.filter(link => !link.pinned)])
const createLinks = computed(() => {
  if (isChat.value && isDesktop.value) return []
  return orderedLinks.value.filter(link => link.pinned && !(link.id === 'new-project' && hidePinnedNewProject(route.path)))
})
const navigationLinks = computed(() => orderedLinks.value.filter(link => !link.pinned))
const showContextNav = computed(() => {
  const links = navigationLinks.value
  if (!createLinks.value.length && links.length === 1 && links[0]!.labelKey === moduleDefinition.value?.labelKey) return false
  return links.length > 0
})
const contextMotionKey = computed(() => `module:${linksModule.value ?? 'none'}`)

function href(link: { to: import('vue-router').RouteLocationRaw }) {
  return link.to
}

function createTo(link: { id: string; to: import('vue-router').RouteLocationRaw }): import('vue-router').RouteLocationRaw {
  return createLinkTo(link, { path: route.path, fullPath: route.fullPath, query: route.query, params: route.params })
}

function updateRoute(next: ChatListRoute) {
  void router.replace({ path: route.path, query: serializeChatListRoute(next) })
}
</script>

<template>
  <aside
    data-testid="context-sidebar"
    class="nasq-context-sidebar"
    :data-project="isProject"
    :data-project-module="isProjectsArea || route.path.startsWith('/projects/settings')"
    :data-chat="isChat"
    :data-expanded="expanded"
    :data-direction="localeProperties.dir"
    :aria-label="t('nav.context')"
  >
    <Transition name="nasq-context" mode="out-in">
      <div :id="navigationId" :key="contextMotionKey" class="nasq-context-sidebar-inner">
      <div class="nasq-context-heading">
        <span class="nasq-context-emblem" aria-hidden="true">
          <UIcon :name="moduleDefinition?.icon ?? shellModules[0]!.icon" class="nasq-shell-icon size-4.5" aria-hidden="true" />
        </span>
        <div class="nasq-context-heading-copy">
          <h2>{{ contextTitle }}</h2>
        </div>
        <div v-if="createLinks.length" class="nasq-context-create-actions">
          <UTooltip v-for="link in createLinks" :key="link.id" :text="t(link.labelKey)">
            <UButton
              :to="createTo(link)"
              color="primary"
              variant="ghost"
              square
              icon="i-lucide-plus"
              class="nasq-context-create-icon"
              :data-active="link.active"
              :aria-current="link.active ? 'page' : undefined"
              :aria-label="t(link.labelKey)"
              :data-testid="`context-link-${link.id}`"
            />
          </UTooltip>
        </div>
      </div>

      <nav v-if="showContextNav" class="nasq-context-links" :data-grouped="activeModule === 'settings' || isProjectsArea" :aria-label="contextTitle">
        <UTooltip v-for="link in navigationLinks" :key="link.id" :text="t(link.labelKey)">
          <UButton
            :to="href(link)"
            color="neutral"
            variant="ghost"
            class="nasq-context-link"
            :data-active="link.active"
            :active="!!link.active"
            :aria-current="link.active ? 'page' : undefined"
            :aria-label="t(link.labelKey)"
            :title="t(link.labelKey)"
            :data-testid="link.id === 'users' ? 'sidebar-settings' : link.id === 'project-settings' ? 'settings-projects-tab' : link.id === 'branding' ? 'settings-branding-tab' : `context-link-${link.id}`"
          >
            <template #leading>
              <UIcon :name="link.icon" class="nasq-shell-icon size-4.5 shrink-0" aria-hidden="true" />
            </template>
            <span data-slot="label">{{ t(link.labelKey) }}</span>
          </UButton>
        </UTooltip>
      </nav>

      <ConversationList
        v-if="isChat && isDesktop"
        v-show="expanded"
        class="min-h-0 flex-1"
        :route-state="routeState"
        :selected-id="selectedConversationId"
        @update:route-state="updateRoute"
      />

      <div class="nasq-context-footer">
        <UTooltip :text="t(expanded ? 'nav.collapseContext' : 'nav.expandContext')">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            square
            class="nasq-context-toggle"
            data-testid="context-sidebar-toggle"
            :disabled="!hydrated"
            :aria-expanded="expanded"
            :aria-controls="navigationId"
            :aria-label="t(expanded ? 'nav.collapseContext' : 'nav.expandContext')"
            @click="toggle"
          >
            <template #leading>
              <UIcon :name="expanded ? 'i-lucide-panel-left-close' : 'i-lucide-panel-left-open'" class="nasq-shell-icon size-4.5 shrink-0" aria-hidden="true" />
            </template>
          </UButton>
        </UTooltip>
      </div>

      </div>
    </Transition>
  </aside>
</template>
