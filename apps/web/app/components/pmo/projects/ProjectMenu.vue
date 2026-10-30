<script setup lang="ts">
import type { Project, ProjectDetail } from '@webvue/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import { ApiError } from '@/composables/useApi'
import { useUnarchiveProject } from '@/composables/useProjects'

const props = defineProps<{ project: Project | ProjectDetail; to?: RouteLocationRaw }>()
// The archive confirmation is drawn by the list (a full-width block); the menu only asks for it.
defineOptions({ inheritAttrs: false })
const emit = defineEmits<{ archive: [] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: unarchiveMutate, isPending: unarchiving } = useUnarchiveProject()

const items = computed<DropdownMenuItem[] | DropdownMenuItem[][]>(() => {
  const list: DropdownMenuItem[] = []
  if (!props.project.active) list.push({ label: t('projects.menu.unarchive'), icon: 'i-lucide-archive-restore', disabled: unarchiving.value, onSelect: doUnarchive })
  // Same grouping as SharedRowActions: destructive items last, in the error colour, opening an inline confirmation in the list.
  if (props.project.active) return [list, [{ label: t('projects.menu.archive'), icon: 'i-lucide-archive', color: 'error', onSelect: () => emit('archive') }]]
  return list
})

async function doUnarchive() {
  try {
    await unarchiveMutate({ id: props.project.id })
    toast.add({ title: t('projects.unarchived'), color: 'success' })
  } catch (e) {
    toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
  }
}

</script>

<template>
  <!-- The trigger matches SharedRowActions; the menu stays a menu even with one item so row layout is stable.
       Someone who cannot manage the project still gets the one quiet "View" action, so every row and card ends the same way. -->
  <UDropdownMenu v-if="project.can_manage" :items="items" :content="{ align: 'end' }">
    <UButton
      type="button"
      data-testid="project-menu"
      color="neutral"
      variant="ghost"
      square
      size="sm"
      icon="i-lucide-ellipsis"
      :disabled="!hydrated"
      :aria-label="t('projects.menu.labelNamed', { name: project.name })"
      v-bind="$attrs"
      @click.stop
    />
  </UDropdownMenu>
  <SharedRowActions
    v-else-if="to"
    :actions="[{ label: t('projects.menu.open'), icon: 'i-lucide-eye', to }]"
    :label="t('projects.menu.labelNamed', { name: project.name })"
    v-bind="$attrs"
  />
</template>
