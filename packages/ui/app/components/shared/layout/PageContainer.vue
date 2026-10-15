<script setup lang="ts">
import { isWorkspaceThemeRoute } from '../../../utils/workspacePresentation'
const props = withDefaults(defineProps<{
  width?: 'list' | 'detail' | 'form'
}>(), {
  width: 'list',
})

const widthClass = computed(() => `nasq-page-width-${props.width}`)
const route = useRoute()
const workspaceArea = computed(() => isWorkspaceThemeRoute(route.path))
const projectRecord = computed(() => /^\/projects\/\d+(\/|$)/.test(route.path))
const projectArea = computed(() => /^\/projects(\/|$)/.test(route.path) || /^\/settings\/projects(\/|$)/.test(route.path))
</script>

<template>
  <div
    data-slot="page-container"
    :data-layout-width="props.width"
    :data-project-area="projectArea || undefined"
    :data-workspace-area="workspaceArea || undefined"
    :data-project-record="projectRecord || undefined"
    :class="['nasq-page-stack', widthClass]"
  >
    <slot />
  </div>
</template>
