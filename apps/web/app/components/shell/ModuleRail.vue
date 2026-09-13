<script setup lang="ts">
import { visibleShellModules } from '@/composables/nav/shellModules'
import { activeShellModule } from '@/composables/nav/activeRoute'
import { useModuleRail } from '@/composables/useShellNavigation'

const { t, localeProperties } = useI18n()
const { me } = useMe()
const route = useRoute()
const { expanded, hydrated, toggle } = useModuleRail()
const availableModules = computed(() => visibleShellModules(me.value))
const activeModule = computed(() => activeShellModule(route.path))
const primaryModules = computed(() => availableModules.value.filter(module => module.id !== 'settings' && module.id !== 'vendor'))
const utilityModules = computed(() => availableModules.value.filter(module => module.id === 'settings' || module.id === 'vendor'))
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
      <UTooltip :text="t(expanded ? 'nav.collapseModules' : 'nav.expandModules')">
        <UButton
        type="button"
        color="neutral"
        variant="ghost"
        class="nasq-module-rail-toggle"
        :disabled="!hydrated"
        :aria-label="t(expanded ? 'nav.collapseModules' : 'nav.expandModules')"
        :aria-expanded="expanded"
        data-testid="module-rail-toggle"
        @click="toggle"
      >
        <template #leading>
          <UIcon :name="expanded ? 'i-lucide-panel-left-close' : 'i-lucide-panel-left-open'" class="nasq-shell-icon size-[18px] shrink-0" aria-hidden="true" />
        </template>
        <span data-slot="label">{{ t(expanded ? 'nav.collapseModules' : 'nav.expandModules') }}</span>
      </UButton>
    </UTooltip>

    <nav class="nasq-module-rail-links" :aria-label="t('nav.modules')">
        <UButton
          v-for="module in primaryModules"
          :key="module.id"
          :to="module.to"
          :external="module.id === 'vendor'"
          color="neutral"
          variant="ghost"
          class="nasq-module-rail-link"
          :data-active="activeModule === module.id"
          :active="activeModule === module.id"
          :aria-current="activeModule === module.id ? 'page' : undefined"
          :aria-label="t(module.labelKey)"
          :title="t(module.labelKey)"
        >
          <template #leading>
            <UIcon :name="module.icon" class="nasq-shell-icon size-[18px] shrink-0" aria-hidden="true" />
          </template>
          <span data-slot="label">{{ t(module.labelKey) }}</span>
        </UButton>
      </nav>
      <nav v-if="utilityModules.length" class="nasq-module-rail-utility" :aria-label="t('nav.settings')">
        <UButton
          v-for="module in utilityModules"
          :key="module.id"
          :to="module.to"
          :external="module.id === 'vendor'"
          color="neutral"
          variant="ghost"
          class="nasq-module-rail-link"
          :data-active="activeModule === module.id"
          :active="activeModule === module.id"
          :aria-current="activeModule === module.id ? 'page' : undefined"
          :aria-label="t(module.labelKey)"
          :title="t(module.labelKey)"
        >
          <template #leading>
            <UIcon :name="module.icon" class="nasq-shell-icon size-[18px] shrink-0" aria-hidden="true" />
          </template>
          <span data-slot="label">{{ t(module.labelKey) }}</span>
        </UButton>
      </nav>
    </div>
  </aside>
</template>
