<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import ProjectCharterReferenceForm from '@/components/settings/ProjectCharterReferenceForm.vue'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { isCharterCatalogResource, useCharterCatalogItem } from '@/composables/useProjectCharterCatalogs'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const { can } = useAccess()
const forbidden = computed(() => !can('pmo.settings.manage'))
const resource = computed(() => (isCharterCatalogResource(route.params.resource) ? route.params.resource : null))
const referenceId = computed(() => {
  const n = Number(route.params.referenceId)
  return Number.isInteger(n) && n > 0 ? n : null
})
const query = useCharterCatalogItem(
  computed(() => resource.value ?? 'types'),
  referenceId,
  computed(() => !forbidden.value && !!resource.value && !!referenceId.value),
)
const notFound = computed(() => !resource.value || referenceId.value === null || (query.error.value instanceof ApiError && [403, 404].includes(query.error.value.status)))
const returnTo = computed(() => {
  const fallback = resource.value ? `/settings/projects/catalogs/${resource.value}` : '/settings/projects'
  return safeReturnTo(route.query.returnTo, fallback, ['/settings/projects', '/projects'])
})

function onSaved() {
  toast.add({ title: t('settings.projects.catalogs.saved'), color: 'success', icon: 'i-lucide-circle-check' })
  router.push(returnTo.value)
}
</script>

<template>
  <SettingsLayout width="form">
    <SharedPageHeader :eyebrow="t('projects.refresh.settings.catalogEyebrow')" :title="t('settings.projects.catalogs.editTitle')" :description="t('projects.refresh.settings.catalogDescription')" :back-to="returnTo" :back-label="t('settings.projects.catalogs.back')" />
    <p v-if="forbidden" class="text-muted">{{ t('settings.forbidden') }}</p>
    <SharedPageState
      v-else
      :loading="query.isLoading.value"
      :error="notFound ? null : query.error.value"
      :empty="notFound || !query.data.value"
      :empty-text="t('settings.projects.catalogs.notFound')"
      @retry="query.refetch"
    >
      <section v-if="query.data.value && resource" class="nasq-ui-record-surface p-5">
        <ProjectCharterReferenceForm :resource="resource" :reference="query.data.value" @saved="onSaved" @cancel="router.push(returnTo)" />
      </section>
    </SharedPageState>
  </SettingsLayout>
</template>
