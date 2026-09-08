<script setup lang="ts">
import { shellBreadcrumbsForDisplay, useShellNavigation } from '@/composables/useShellNavigation'
import { ChevronLeft } from '@lucide/vue'

const { t, localeProperties } = useI18n()
const { me } = useMe()
const route = useRoute()
const router = useRouter()
const { breadcrumbs, contextLinks } = useShellNavigation(() => me.value)
const breadcrumbTarget = useShellBreadcrumbTarget()
const visibleBreadcrumbs = computed(() => shellBreadcrumbsForDisplay(breadcrumbs.value, contextLinks.value, to => router.resolve(to)))

watchEffect(() => {
  const ancestor = breadcrumbs.value.find(crumb => crumb.to && !crumb.current)
  breadcrumbTarget.value = {
    routeKey: breadcrumbs.value.length ? route.fullPath : '',
    href: ancestor?.to ? router.resolve(ancestor.to).fullPath : null,
  }
})
</script>

<template>
  <nav v-if="visibleBreadcrumbs.length" data-testid="shell-breadcrumb" class="nasq-shell-breadcrumb" :aria-label="t('nav.breadcrumb')" :dir="localeProperties.dir">
    <template v-for="(crumb, index) in visibleBreadcrumbs" :key="crumb.id">
      <ChevronLeft v-if="index" aria-hidden="true" class="nasq-shell-breadcrumb-separator ltr:rotate-180" />
      <NuxtLink v-if="crumb.to && !crumb.current" :to="crumb.to" class="nasq-shell-breadcrumb-link">{{ crumb.raw ? crumb.labelKey : t(crumb.labelKey) }}</NuxtLink>
      <span v-else class="nasq-shell-breadcrumb-current" aria-current="page">{{ crumb.raw ? crumb.labelKey : t(crumb.labelKey) }}</span>
    </template>
  </nav>
</template>
