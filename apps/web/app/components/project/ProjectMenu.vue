<script setup lang="ts">
import type { Project, ProjectDetail } from '@nasq/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import { ApiError } from '@/composables/useApi'
import { useArchiveProject, useUnarchiveProject } from '@/composables/useProjects'

const props = withDefaults(defineProps<{ project: Project | ProjectDetail; hideSettings?: boolean }>(), { hideSettings: false })
const emit = defineEmits<{ settings: []; archived: []; unarchived: [] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: archiveMutate, isPending: archiving } = useArchiveProject()
const { mutateAsync: unarchiveMutate, isPending: unarchiving } = useUnarchiveProject()

const confirmOpen = ref(false)

const items = computed<DropdownMenuItem[]>(() => {
  const list: DropdownMenuItem[] = []
  if (!props.hideSettings) list.push({ label: t('projects.menu.settings'), onSelect: () => emit('settings') })
  if (props.project.active) list.push({ label: t('projects.menu.archive'), onSelect: () => { confirmOpen.value = true } })
  else list.push({ label: t('projects.menu.unarchive'), disabled: unarchiving.value, onSelect: doUnarchive })
  return list
})

async function doArchive() {
  try {
    await archiveMutate({ id: props.project.id })
    toast.add({ title: t('projects.archived'), color: 'success' })
    confirmOpen.value = false
    emit('archived')
  } catch (e) {
    toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
  }
}

async function doUnarchive() {
  try {
    await unarchiveMutate({ id: props.project.id })
    toast.add({ title: t('projects.unarchived'), color: 'success' })
    emit('unarchived')
  } catch (e) {
    toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
  }
}

</script>

<template>
  <UDropdownMenu v-if="project.can_manage" :items="items" :content="{ align: 'end' }">
    <UButton
      type="button"
      data-testid="project-menu"
      color="primary"
      variant="outline"
      square
      icon="i-lucide-more-horizontal"
      :disabled="!hydrated"
      :aria-label="t('projects.menu.label')"
      @click.stop
    />
  </UDropdownMenu>

  <UAlert
    v-if="project.active && confirmOpen"
    color="error"
    variant="soft"
    data-testid="project-archive-confirm"
    :title="t('projects.archiveConfirmTitle')"
    :description="t('projects.archiveConfirmText')"
  >
    <template #actions>
      <div class="flex flex-wrap justify-end gap-2 w-full">
        <UButton type="button" color="neutral" :disabled="archiving" @click="confirmOpen = false" variant="outline">{{ t('app.cancel') }}</UButton>
        <UButton type="button" color="error" :loading="archiving" @click="doArchive">{{ t('projects.menu.archive') }}</UButton>
      </div>
    </template>
  </UAlert>
</template>
