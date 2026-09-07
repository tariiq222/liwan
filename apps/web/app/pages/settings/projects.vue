<script setup lang="ts">
import ProjectSettingsForm from '@/components/settings/ProjectSettingsForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('pmo.settings.manage'))
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isBaseRoute = computed(() => normalizedPath.value === '/settings/projects')
</script>

<template>
  <SettingsLayout>
    <div v-if="isBaseRoute" class="nasq-page-stack nasq-settings-form-page">
      <SharedPageHeader :title="t('settings.projects.title')" />

      <p v-if="forbidden" class="text-muted-foreground">{{ t('settings.forbidden') }}</p>
      <template v-else>
        <ProjectSettingsForm />
        <section class="nasq-panel space-y-3 p-5">
          <h2 class="nasq-form-section-title">{{ t('settings.projects.catalogs.title') }}</h2>
          <p class="text-sm text-muted-foreground">{{ t('settings.projects.catalogs.hint') }}</p>
          <div class="flex flex-wrap gap-3 text-sm">
            <NuxtLink
              :to="{ path: '/settings/projects/catalogs/types', query: returnToQuery(route.fullPath) }"
              class="underline underline-offset-4"
              data-testid="catalog-types-link"
            >
              {{ t('settings.projects.catalogs.types') }}
            </NuxtLink>
            <NuxtLink
              :to="{ path: '/settings/projects/catalogs/owning-units', query: returnToQuery(route.fullPath) }"
              class="underline underline-offset-4"
              data-testid="catalog-units-link"
            >
              {{ t('settings.projects.catalogs.owningUnits') }}
            </NuxtLink>
          </div>
        </section>
      </template>
    </div>
    <NuxtPage v-else />
  </SettingsLayout>
</template>
