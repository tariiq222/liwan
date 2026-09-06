<script setup lang="ts">
import { toast } from 'vue-sonner'
import ProjectCharterReferenceForm from '@/components/settings/ProjectCharterReferenceForm.vue'
import { isCharterCatalogResource } from '@/composables/useProjectCharterCatalogs'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const forbidden = computed(() => !can('pmo.settings.manage'))
const resource = computed(() => (isCharterCatalogResource(route.params.resource) ? route.params.resource : null))
const returnTo = computed(() => {
  const fallback = resource.value ? `/settings/projects/catalogs/${resource.value}` : '/settings/projects'
  return safeReturnTo(route.query.returnTo, fallback, ['/settings/projects', '/projects'])
})
const title = computed(() => resource.value === 'owning-units'
  ? t('settings.projects.catalogs.newUnit')
  : t('settings.projects.catalogs.newType'))

function onSaved() {
  toast.success(t('settings.projects.catalogs.created'))
  router.push(returnTo.value)
}
</script>

<template>
  <section class="mx-auto w-full max-w-2xl space-y-6">
    <nav><NuxtLink :to="returnTo" class="text-sm text-muted-foreground hover:underline">{{ t('settings.projects.catalogs.back') }}</NuxtLink></nav>
    <h1 class="text-2xl font-semibold">{{ title }}</h1>
    <p v-if="!resource" class="text-muted-foreground">{{ t('settings.projects.catalogs.notFound') }}</p>
    <p v-else-if="forbidden" class="text-muted-foreground">{{ t('settings.forbidden') }}</p>
    <Card v-else>
      <CardContent class="pt-6">
        <ProjectCharterReferenceForm :resource="resource" @saved="onSaved" @cancel="router.push(returnTo)" />
      </CardContent>
    </Card>
  </section>
</template>
