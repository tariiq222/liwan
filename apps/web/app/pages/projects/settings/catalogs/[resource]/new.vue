<script setup lang="ts">
import ProjectCharterReferenceForm from '@/components/settings/ProjectCharterReferenceForm.vue'
import { isCharterCatalogResource } from '@/composables/useProjectCharterCatalogs'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const { can } = useAccess()
const forbidden = computed(() => !can('pmo.settings.manage'))
const resource = computed(() => (isCharterCatalogResource(route.params.resource) ? route.params.resource : null))
const returnTo = computed(() => {
  const fallback = resource.value ? `/projects/settings/catalogs/${resource.value}` : '/projects/settings'
  return safeReturnTo(route.query.returnTo, fallback, ['/projects/settings', '/projects'])
})
const title = computed(() => resource.value === 'owning-units'
  ? t('settings.projects.catalogs.newUnit')
  : t('settings.projects.catalogs.newType'))

function onSaved() {
  toast.add({ title: t('settings.projects.catalogs.created'), color: 'success', icon: 'i-lucide-circle-check' })
  router.push(returnTo.value)
}
</script>

<template>
  <SharedCreatePanel :title="title" :description="t('projects.refresh.settings.catalogDescription')" :back-to="returnTo">
    <p v-if="!resource" class="text-muted">{{ t('settings.projects.catalogs.notFound') }}</p>
    <p v-else-if="forbidden" class="text-muted">{{ t('settings.forbidden') }}</p>
    <ProjectCharterReferenceForm v-else :resource="resource" @saved="onSaved" @cancel="router.push(returnTo)" />
  </SharedCreatePanel>
</template>
