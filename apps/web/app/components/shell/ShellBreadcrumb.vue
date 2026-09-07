<script setup lang="ts">
import { ChevronLeft } from '@lucide/vue'

const { t, localeProperties } = useI18n()
const { me } = useMe()
const { breadcrumbs } = useShellNavigation(() => me.value)
</script>

<template>
  <nav v-if="breadcrumbs.length" data-testid="shell-breadcrumb" class="nasq-shell-breadcrumb" :aria-label="t('nav.breadcrumb')" :dir="localeProperties.dir">
    <template v-for="(crumb, index) in breadcrumbs" :key="crumb.id">
      <ChevronLeft v-if="index" aria-hidden="true" class="nasq-shell-breadcrumb-separator ltr:rotate-180" />
      <NuxtLink v-if="crumb.to && !crumb.current" :to="crumb.to" class="nasq-shell-breadcrumb-link">{{ crumb.raw ? crumb.labelKey : t(crumb.labelKey) }}</NuxtLink>
      <span v-else class="nasq-shell-breadcrumb-current" aria-current="page">{{ crumb.raw ? crumb.labelKey : t(crumb.labelKey) }}</span>
    </template>
  </nav>
</template>
