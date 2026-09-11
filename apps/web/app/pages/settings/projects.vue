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
  <SettingsLayout v-if="isBaseRoute" width="form">
    <SharedPageHeader :title="t('settings.projects.title')" />
    <p v-if="forbidden" class="text-muted">{{ t('settings.forbidden') }}</p>
    <div v-else class="space-y-6">
      <p class="mb-5 text-sm leading-6 text-muted">{{ t('settings.projects.scopeHint') }}</p>
      <ProjectSettingsForm />
      <section id="catalogs" class="nasq-settings-anchor space-y-3">
        <h2 class="text-lg font-semibold text-highlighted">{{ t('settings.projects.catalogs.title') }}</h2>
        <p class="text-sm text-muted">{{ t('settings.projects.catalogs.hint') }}</p>
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
    </div>
  </SettingsLayout>
  <NuxtPage v-else />
</template>
