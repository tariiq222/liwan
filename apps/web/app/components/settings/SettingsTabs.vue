<script setup lang="ts">
const route = useRoute()
const { can } = useAccess()
const { t } = useI18n()
</script>

<template>
  <nav class="flex flex-wrap gap-2 border-b" :aria-label="t('settings.tabs.label')">
    <NuxtLink
      v-if="can('pmo.settings.manage')" to="/settings/projects"
      data-testid="settings-projects-tab"
      class="border-b-2 px-3 py-2 text-sm font-medium"
      :class="route.path === '/settings/projects' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'"
    >
      {{ t('settings.projects.title') }}
    </NuxtLink>
    <NuxtLink
      v-if="can('settings.branding.manage')" to="/settings/branding"
      data-testid="settings-branding-tab"
      class="border-b-2 px-3 py-2 text-sm font-medium"
      :class="route.path === '/settings/branding' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'"
    >
      {{ t('settings.branding.title') }}
    </NuxtLink>
  </nav>
</template>
