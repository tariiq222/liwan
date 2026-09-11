import { normalizeAppearance } from '#nasq-utils/appearance'
import { DEFAULT_PRIMARY, derivedSecondary } from '#nasq-utils/brandTheme'

export type PreviewModule = 'projects' | 'tasks' | 'meetings' | 'hr'
export type PreviewStatus = 'active' | 'done' | 'waiting'
export interface PreviewRecord {
  id: number
  title: string
  titleKey?: string
  owner: string
  due: string
  state: PreviewStatus
  progress: number
  description: string
}
export const previewModules: PreviewModule[] = ['projects', 'tasks', 'meetings', 'hr']
export const previewViews = ['dashboard', 'list', 'detail', 'form', 'settings', 'components'] as const
export const previewModuleIcons = ['i-lucide-folder-kanban', 'i-lucide-list-checks', 'i-lucide-calendar-days', 'i-lucide-users']
export const previewViewIcons = ['i-lucide-chart-no-axes-combined', 'i-lucide-layout-list', 'i-lucide-file-text', 'i-lucide-square-pen', 'i-lucide-settings-2', 'i-lucide-blocks']

export function usePreview() {
  const { t, locale, setLocale: applyLocale } = useI18n()
  const localeCookie = useCookie('nasq-design-locale', { default: () => 'ar', sameSite: 'lax' })
  async function setLocale(value: 'ar' | 'en') { localeCookie.value = value; await applyLocale(value) }
  const route = useRoute()
  const appearanceCookie = useCookie('nasq-design-appearance', { default: () => normalizeAppearance(null), sameSite: 'lax' })
  const appearance = computed(() => normalizeAppearance(appearanceCookie.value))
  const brand = useCookie('nasq-design-brand', { default: () => DEFAULT_PRIMARY, sameSite: 'lax' })
  const secondary = useCookie('nasq-design-secondary', { default: () => derivedSecondary(DEFAULT_PRIMARY), sameSite: 'lax' })
  const module = computed<PreviewModule>(() => previewModules.includes(route.query.module as PreviewModule) ? route.query.module as PreviewModule : 'projects')
  const state = computed(() => ['loading', 'error', 'empty', 'readonly'].includes(String(route.query.state)) ? String(route.query.state) : 'normal')
  const canEdit = computed(() => state.value !== 'readonly')
  const records = useState<Record<PreviewModule, PreviewRecord[]>>('design-records', () => Object.fromEntries(
    previewModules.map((name, moduleIndex) => [name, Array.from({ length: 6 }, (_, index) => ({
      id: (moduleIndex + 1) * 100 + index + 1, title: '', titleKey: `samples.${name}${index + 1}`,
      owner: ['sara', 'omar', 'noura'][index % 3]!, due: `2026-09-${20 + index}`,
      state: (['active', 'done', 'waiting', 'active', 'done', 'active'] as PreviewStatus[])[index]!,
      progress: [68, 100, 0, 42, 100, 25][index]!, description: '',
    }))]),
  ) as Record<PreviewModule, PreviewRecord[]>)
  const items = computed(() => records.value[module.value])
  const titleOf = (record: PreviewRecord) => record.titleKey ? t(record.titleKey) : record.title
  const statusColor = (status: PreviewStatus) => ({ active: 'info', done: 'success', waiting: 'warning' } as const)[status]
  const link = (view: string, extra: Record<string, string | number | undefined> = {}) => ({
    path: `/${view}`, query: { module: module.value, q: route.query.q, status: route.query.status, ...extra },
  })
  const setAppearance = (key: 'mode' | 'fontSize', value: string) => {
    appearanceCookie.value = normalizeAppearance({ ...appearance.value, [key]: value })
  }
  return { t, locale, localeCookie, setLocale, route, appearance, brand, secondary, module, state, canEdit, records, items, titleOf, statusColor, link, setAppearance }
}
