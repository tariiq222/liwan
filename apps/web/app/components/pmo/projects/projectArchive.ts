import type { Project } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useArchiveProject } from '@/composables/useProjects'

/** The archive confirmation of a project list: the list owns one full-width inline confirm, the row menu only asks for it. */
export function useProjectArchive() {
  const { t } = useI18n()
  const toast = useToast()
  const { mutateAsync, isPending } = useArchiveProject()
  const target = ref<Pick<Project, 'id'> | null>(null)

  async function archive() {
    if (!target.value) return
    try {
      await mutateAsync({ id: target.value.id })
      toast.add({ title: t('projects.archived'), color: 'success' })
      target.value = null
    } catch (e) {
      toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
    }
  }

  return { target, pending: isPending, request: (project: Pick<Project, 'id'>) => { target.value = project }, cancel: () => { target.value = null }, archive }
}
