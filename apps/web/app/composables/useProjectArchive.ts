import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { ApiError } from './useApi'
import { useArchiveProject, useUnarchiveProject } from './useProjects'

/** Archive and restore of one project, with the toast each outcome shows. Shared by the project header menu and the settings page. */
export function useProjectArchive(project: MaybeRefOrGetter<{ id: number; can_manage: boolean } | undefined>) {
  const { t } = useI18n()
  const hydrated = useHydrated()
  const toast = useToast()
  const { mutateAsync: archiveProject, isPending: archiving } = useArchiveProject()
  const { mutateAsync: restoreProject, isPending: restoring } = useUnarchiveProject()
  const pending = computed(() => archiving.value || restoring.value)

  async function run(action: typeof archiveProject, success: string): Promise<boolean> {
    const value = toValue(project)
    if (!value?.can_manage || !hydrated.value || pending.value) return false
    try {
      await action({ id: value.id })
      toast.add({ title: t(success), color: 'success' })
      return true
    } catch (error) {
      toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
      return false
    }
  }

  return {
    pending,
    /** Resolves true when the project was archived. */
    archive: () => run(archiveProject, 'projects.archived'),
    /** Resolves true when the project was restored. */
    restore: () => run(restoreProject, 'projects.unarchived'),
  }
}
