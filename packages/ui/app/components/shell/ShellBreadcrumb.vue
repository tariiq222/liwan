<script setup lang="ts">
import type { ShellCrumb } from '../../types/shell'

// The one breadcrumb (ui_policy breadcrumb_errors): module › section › page.
const props = defineProps<{ items: ShellCrumb[] }>()
const { t } = useI18n()
// The last crumb is the current page: UBreadcrumb sets aria-current only when it is marked active.
const items = computed(() => props.items.map((item, index) => ({ label: item.label, to: item.to, active: index === props.items.length - 1 && !item.to })))
</script>

<template>
  <UBreadcrumb v-if="items.length" :items="items" :aria-label="t('nav.breadcrumb')" data-testid="shell-breadcrumb" class="liwan-shell-breadcrumb" />
</template>
