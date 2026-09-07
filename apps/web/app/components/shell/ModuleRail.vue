<script setup lang="ts">
import { PanelLeftClose, PanelLeftOpen } from '@lucide/vue'
import { activeShellModule, shellModules } from '@/composables/useNav'
import { useModuleRail } from '@/composables/useShellNavigation'
import { firstAllowedPath } from '@/utils/accessPolicy'

const { t, localeProperties } = useI18n()
const { me } = useMe()
const route = useRoute()
const { expanded, hydrated, toggle } = useModuleRail()
const nav = computed(() => useNav(me.value))
const availableModules = computed(() => shellModules.filter(module => nav.value.some(item => item.module === module.id || item.group === module.id)))
const activeModule = computed(() => activeShellModule(route.path))
const fallbackPath = computed(() => firstAllowedPath(me.value))
</script>

<template>
  <aside
    data-testid="module-rail"
    class="nasq-module-rail"
    :data-expanded="expanded"
    :data-direction="localeProperties.dir"
    :aria-label="t('nav.modules')"
  >
    <div class="nasq-module-rail-inner">
      <button
        type="button"
        class="nasq-module-rail-toggle"
        :disabled="!hydrated"
        :aria-label="t(expanded ? 'nav.collapseModules' : 'nav.expandModules')"
        :aria-expanded="expanded"
        data-testid="module-rail-toggle"
        @click="toggle"
      >
        <PanelLeftClose v-if="expanded" aria-hidden="true" />
        <PanelLeftOpen v-else aria-hidden="true" />
        <span>{{ t(expanded ? 'nav.collapseModules' : 'nav.expandModules') }}</span>
      </button>

      <nav class="nasq-module-rail-links" :aria-label="t('nav.modules')">
        <NuxtLink
          v-for="module in availableModules"
          :key="module.id"
          :to="module.to || fallbackPath"
          class="nasq-module-rail-link"
          :data-active="activeModule === module.id"
          :aria-current="activeModule === module.id ? 'page' : undefined"
          :aria-label="t(module.labelKey)"
          :title="t(module.labelKey)"
        >
          <component :is="module.icon" aria-hidden="true" />
          <span>{{ t(module.labelKey) }}</span>
        </NuxtLink>
      </nav>
    </div>
  </aside>
</template>
