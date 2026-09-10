<script setup lang="ts">
import { brandPairContrast } from '#nasq-utils/brandTheme'
const { t, locale, setLocale, appearance, brand, secondary, module, route, setAppearance } = usePreview()
const lowContrast = computed(() => brandPairContrast(brand.value, secondary.value) < 4.5)
const optionsOpen = ref(false)
const collapsed = useState('design-sidebar-collapsed', () => false)
const options = (keys: string[]) => keys.map(value => ({ value, label: t(value) }))
function changeState(value: string) {
  return navigateTo({ path: route.path, query: { ...route.query, state: value === 'normal' ? undefined : value } })
}
function focusMain() { document.getElementById('preview-main')?.focus() }
</script>

<template>
  <div class="preview-shell" :class="{ 'is-collapsed': collapsed }">
    <a href="#preview-main" class="preview-skip" @click.prevent="focusMain">{{ t('skip') }}</a>
    <header class="preview-header">
      <div class="flex items-center gap-2">
      <PreviewMobileNavigation />
      <NuxtLink to="/dashboard" class="flex items-center gap-2 font-semibold text-xl" :aria-label="t('brand')">
        <UIcon name="i-lucide-orbit" class="size-6" />{{ t('brand') }}
      </NuxtLink>
      </div>
      <span class="preview-header-title">{{ t('reference') }}</span>
      <div class="flex items-center gap-1">
        <UButton class="preview-header-button" color="neutral" variant="ghost" :label="locale === 'ar' ? 'English' : 'العربية'" @click="setLocale(locale === 'ar' ? 'en' : 'ar')" />
        <UButton class="preview-header-button" color="neutral" variant="ghost" icon="i-lucide-sliders-horizontal" :aria-label="t('preferences')" :aria-expanded="optionsOpen" aria-controls="preview-options" @click="optionsOpen = !optionsOpen" />
      </div>
    </header>

    <nav class="preview-rail" :aria-label="t('workspace')">
      <UTooltip v-for="(name, index) in previewModules" :key="name" :text="t(name)">
        <UButton :to="{ path: '/list', query: { module: name } }" :icon="previewModuleIcons[index]" :aria-label="t(name)" :aria-current="module === name ? 'page' : undefined" class="preview-rail-button" color="neutral" variant="ghost" />
      </UTooltip>
      <div class="flex-1" />
      <UTooltip :text="t('components')">
        <UButton to="/components" icon="i-lucide-blocks" :aria-label="t('components')" class="preview-rail-button" color="neutral" variant="ghost" />
      </UTooltip>
    </nav>

    <aside class="preview-sidebar">
      <div class="preview-context-heading">
        <div v-if="!collapsed" class="min-w-0"><h2 class="font-semibold text-lg">{{ t(module) }}</h2><p class="text-xs text-muted mt-1">{{ t('recipes') }}</p></div>
        <UButton color="neutral" variant="ghost" icon="i-lucide-panel-right-close" :aria-label="t(collapsed ? 'expand' : 'collapse')" :aria-expanded="!collapsed" aria-controls="preview-context-nav" @click="collapsed = !collapsed" />
      </div>
      <nav id="preview-context-nav" :aria-label="t('recipes')" class="preview-context-nav">
        <UButton v-for="(view, index) in previewViews" :key="view" :to="{ path: `/${view}`, query: { module } }" :icon="previewViewIcons[index]" :label="collapsed ? undefined : t(view)" :aria-label="t(view)" :aria-current="route.path === `/${view}` ? 'page' : undefined" variant="ghost" color="neutral" class="preview-context-link" />
      </nav>
      <div v-if="!collapsed" class="preview-sidebar-note"><UIcon name="i-lucide-component" class="size-4" /><span>Nuxt UI · {{ t('demo') }}</span></div>
    </aside>

    <div class="preview-workspace">
      <section v-show="optionsOpen" id="preview-options" class="preview-options" :aria-label="t('preferences')">
        <UFormField :label="t('appearance')"><USelect :model-value="appearance.mode" :items="options(['light', 'cream', 'dark'])" @update:model-value="value => setAppearance('mode', value)" /></UFormField>
        <UFormField :label="t('fontSize')"><USelect :model-value="appearance.fontSize" :items="options(['small', 'medium', 'large'])" @update:model-value="value => setAppearance('fontSize', value)" /></UFormField>
        <UFormField :label="t('state')"><USelect :model-value="String(route.query.state || 'normal')" :items="options(['normal', 'loading', 'error', 'empty', 'readonly'])" @update:model-value="changeState" /></UFormField>
        <UFormField :label="t('primary')"><UInput v-model="brand" type="color" class="w-24" /></UFormField>
        <UFormField :label="t('secondary')"><UInput v-model="secondary" type="color" class="w-24" /></UFormField>
        <UAlert v-if="lowContrast" color="warning" icon="i-lucide-triangle-alert" :title="t('colorContrastHint')" class="w-full" />
      </section>
      <div class="preview-notice"><UIcon name="i-lucide-flask-conical" class="size-4 shrink-0" /><span>{{ t('demoNote') }}</span></div>
      <main id="preview-main" tabindex="-1" class="preview-main"><slot /></main>
    </div>
  </div>
</template>
