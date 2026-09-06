<script setup lang="ts">
import { SlidersHorizontal, FolderKanban, Users, ShieldCheck, ScrollText } from '@lucide/vue'
const route = useRoute()
const { can } = useAccess()
const { t } = useI18n()
</script>

<template>
  <nav class="nasq-settings-nav" :aria-label="t('settings.tabs.label')">
    <NuxtLink
      to="/settings/appearance"
      data-testid="settings-appearance-tab"
      :aria-current="route.path === '/settings/appearance' ? 'page' : undefined"
    >
      <SlidersHorizontal aria-hidden="true" />
      {{ t('settings.appearance.title') }}
    </NuxtLink>
    <NuxtLink
      v-if="can('pmo.settings.manage')" to="/settings/projects"
      data-testid="settings-projects-tab"
      :aria-current="route.path === '/settings/projects' ? 'page' : undefined"
    >
      <FolderKanban aria-hidden="true" />
      {{ t('settings.projects.title') }}
    </NuxtLink>
    <NuxtLink v-if="can('access.users.read')" to="/settings/users" :aria-current="route.path.startsWith('/settings/users') ? 'page' : undefined">
      <Users aria-hidden="true" />{{ t('nav.users') }}
    </NuxtLink>
    <NuxtLink v-if="can('access.roles.read')" to="/settings/roles" :aria-current="route.path.startsWith('/settings/roles') ? 'page' : undefined">
      <ShieldCheck aria-hidden="true" />{{ t('nav.roles') }}
    </NuxtLink>
    <NuxtLink v-if="can('access.audit.read')" to="/settings/access-log" :aria-current="route.path.startsWith('/settings/access-log') ? 'page' : undefined">
      <ScrollText aria-hidden="true" />{{ t('nav.accessLog') }}
    </NuxtLink>
  </nav>
</template>
