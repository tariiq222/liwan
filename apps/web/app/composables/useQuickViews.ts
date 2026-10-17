import type { ShellQuickItem } from '@webvue/ui/app/types/shell'
import { quickViewsModel } from './nav/quickViewsModel'
import { hasNoContextSidebar } from '../components/shell/noContextRoutes'
import { useShellModel } from './useShellModel'

/** The quick views card (desktop) and the drawer section (mobile): one model, labels translated here. */
export function useQuickViews() {
  const { t } = useI18n()
  const route = useRoute()
  const { can } = useAccess()
  const { createTo } = useShellModel()
  const model = computed(() => hasNoContextSidebar(route.path)
    ? { views: [], actions: [] }
    : quickViewsModel({ path: route.path, query: route.query, can, createTo }))
  const item = (entry: { id: string; labelKey: string; icon: string; to: ShellQuickItem['to']; active: boolean; primary?: boolean }): ShellQuickItem => ({
    id: entry.id, label: t(entry.labelKey), icon: entry.icon, to: entry.to, active: entry.active, primary: entry.primary,
  })
  const views = computed(() => model.value.views.map(item))
  const actions = computed(() => model.value.actions.map(item))
  return { views, actions }
}
