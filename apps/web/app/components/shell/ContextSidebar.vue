<script setup lang="ts">
import { ArrowRight, ChevronLeft } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import ConversationList from '@/components/chat/ConversationList.vue'
import { useShellNavigation } from '@/composables/useShellNavigation'
import { activeShellModule, contextGroupsForModule, shellModules } from '@/composables/useNav'
import { parseChatListRoute, serializeChatListRoute, type ChatListRoute } from '@/utils/chatState'
import { projectListReturnTo } from '@/utils/projectNavigation'

const { t, localeProperties } = useI18n()
const { me } = useMe()
const route = useRoute()
const router = useRouter()
const { module, projectId, project, contextLinks } = useShellNavigation(() => me.value)
const activeModule = computed(() => activeShellModule(route.path))
const moduleDefinition = computed(() => shellModules.find(item => item.id === activeModule.value) ?? module.value)
const contextTitle = computed(() => projectId.value && project.data.value ? project.data.value.name : moduleDefinition.value ? t(moduleDefinition.value.labelKey) : t('app.productName'))
const contextDescription = computed(() => projectId.value ? (project.data.value?.description_html?.replace(/<[^>]+>/g, '').trim() || '') : '')
const projectsReturnTo = computed(() => projectListReturnTo(route.query))
const isProject = computed(() => !!projectId.value && activeModule.value === 'projects')
const isChat = computed(() => activeModule.value === 'chat')
const isDesktop = useMediaQuery('(min-width: 761px)', { ssrWidth: 1024 })
const routeState = computed(() => parseChatListRoute(route.query))
const selectedConversationId = computed(() => {
  const match = route.path.match(/^\/chat\/(\d+)(?:\/|$)/)
  const id = Number(match?.[1])
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
})
const primaryLinks = computed(() => contextLinks.value.filter(item => !isProject.value || item.id !== 'settings'))
const moduleLinks = computed(() => {
  const links = isChat.value && isDesktop.value
    ? primaryLinks.value.filter(item => item.id === 'new-chat')
    : primaryLinks.value
  if (activeModule.value === 'projects') return links
  return [...links.filter(item => item.pinned), ...links.filter(item => !item.pinned)]
})
const contextGroups = computed(() => {
  if (activeModule.value === 'settings') {
    return contextGroupsForModule('settings', me.value)
      .map(group => ({ ...group, links: group.links.map(link => moduleLinks.value.find(item => item.id === link.id)).filter((link): link is NonNullable<typeof link> => Boolean(link)) }))
      .filter(group => group.links.length)
  }
  return moduleLinks.value.length ? [{ id: 'default' as const, links: moduleLinks.value }] : []
})
const showContextNav = computed(() => {
  const links = contextGroups.value.flatMap(group => group.links)
  if (links.length === 1 && links[0]!.labelKey === moduleDefinition.value?.labelKey) return false
  return links.length > 0
})
const contextMotionKey = computed(() => {
  const moduleKey = activeModule.value ?? 'none'
  if (projectId.value && activeModule.value === 'projects') return `project:${projectId.value}`
  return `module:${moduleKey}`
})

function href(link: { to: import('vue-router').RouteLocationRaw }) {
  return link.to
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
    :data-chat="isChat"
    :data-direction="localeProperties.dir"
    :aria-label="t('nav.context')"
  >
    <Transition name="nasq-context" mode="out-in">
      <div :key="contextMotionKey" class="nasq-context-sidebar-inner">
      <NuxtLink v-if="isProject" :to="projectsReturnTo" class="nasq-context-back" :aria-label="t('nav.backToProjects')">
        <ArrowRight aria-hidden="true" class="ltr:rotate-180" />
        <span>{{ t('nav.backToProjects') }}</span>
      </NuxtLink>
      <div class="nasq-context-heading">
        <span class="nasq-context-emblem" aria-hidden="true">
          <component :is="moduleDefinition?.icon ?? shellModules[0]!.icon" />
        </span>
        <div class="nasq-context-heading-copy">
          <h2>{{ contextTitle }}</h2>
          <p v-if="contextDescription">{{ contextDescription }}</p>
        </div>
      </div>

      <nav v-if="showContextNav" class="nasq-context-links" :data-grouped="activeModule === 'settings'" :aria-label="contextTitle">
        <div v-for="group in contextGroups" :key="group.id" class="nasq-context-group">
          <h3 v-if="group.labelKey" class="nasq-context-group-heading">{{ t(group.labelKey) }}</h3>
          <div class="nasq-context-group-links">
            <NuxtLink
              v-for="link in group.links"
              :key="link.id"
              :to="href(link)"
              :class="['nasq-context-link', link.pinned && 'nasq-context-create']"
              :data-active="link.active"
              :aria-current="link.active ? 'page' : undefined"
              :data-testid="link.id === 'appearance' ? 'sidebar-settings' : link.id === 'project-settings' ? 'settings-projects-tab' : `context-link-${link.id}`"
            >
              <component :is="link.icon" aria-hidden="true" />
              <span>{{ t(link.labelKey) }}</span>
              <ChevronLeft v-if="link.active" aria-hidden="true" class="nasq-context-active-mark ltr:rotate-180" />
            </NuxtLink>
          </div>
        </div>
      </nav>

      <ConversationList
        v-if="isChat && isDesktop"
        class="min-h-0 flex-1"
        :route-state="routeState"
        :selected-id="selectedConversationId"
        @update:route-state="updateRoute"
      />

      <div v-if="isProject" class="nasq-context-footer">
        <NuxtLink
          v-for="link in contextLinks.filter(item => item.id === 'settings')"
          :key="link.id"
          :to="href(link)"
          class="nasq-context-link"
          :data-active="link.active"
          :aria-current="link.active ? 'page' : undefined"
          data-testid="context-link-settings"
        >
          <component :is="link.icon" aria-hidden="true" />
          <span>{{ t(link.labelKey) }}</span>
        </NuxtLink>
      </div>
      </div>
    </Transition>
  </aside>
</template>
