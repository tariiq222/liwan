<script setup lang="ts">
import { useShellNavigation } from '@/composables/useShellNavigation'
import { ChevronLeft } from '@lucide/vue'

const { t, localeProperties } = useI18n()
const { me } = useMe()
const route = useRoute()
const router = useRouter()
const { breadcrumbs, projectId } = useShellNavigation(() => me.value)
const { title: pageTitle } = useShellPageHeader()
const breadcrumbTarget = useShellBreadcrumbTarget()

watchEffect(() => {
  const first = breadcrumbs.value[0]
  breadcrumbTarget.value = {
    routeKey: route.fullPath,
    href: projectId.value && first?.to ? router.resolve(first.to).fullPath : null,
  }
})
</script>

<template>
  <nav v-if="breadcrumbs.length" data-testid="shell-breadcrumb" class="nasq-shell-breadcrumb" :aria-label="t('nav.breadcrumb')" :dir="localeProperties.dir">
    <template v-for="(crumb, index) in breadcrumbs" :key="crumb.id">
      <ChevronLeft v-if="index" aria-hidden="true" class="nasq-shell-breadcrumb-separator ltr:rotate-180" />
      <NuxtLink v-if="crumb.to && !crumb.current" :to="crumb.to" class="nasq-shell-breadcrumb-link">{{ crumb.raw ? crumb.labelKey : t(crumb.labelKey) }}</NuxtLink>
      <span v-else class="nasq-shell-breadcrumb-current" aria-current="page">{{ crumb.raw ? crumb.labelKey : t(crumb.labelKey) }}</span>
    </template>
    <template v-if="projectId && pageTitle">
      <ChevronLeft aria-hidden="true" class="nasq-shell-breadcrumb-separator ltr:rotate-180" />
      <span class="nasq-shell-breadcrumb-current" aria-current="page">{{ pageTitle }}</span>
    </template>
  </nav>
</template>
