import { computed } from 'vue'

/** The cookie that remembers whether the pages' KPI strips are drawn; read on the server, so a hidden strip never flashes. */
export const KPI_COOKIE = 'webvue-kpis'
export type KpiVisibility = 'shown' | 'hidden'

/**
 * The one show/hide preference for every KPI strip (DESIGN.md): per browser, not per page, default shown.
 * `SharedKpiStrip` and the toggle in `SharedPageHeader` (`kpi-toggle`) both read it; a page that draws its own
 * tiles wraps them in `v-if="shown"`.
 */
export function useKpiVisibility() {
  const cookie = useCookie<KpiVisibility>(KPI_COOKIE, {
    default: () => 'shown',
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })
  // Shared by every caller on the page, so the toggle in the header and the strip below it stay in step.
  const state = useState<KpiVisibility>('kpi-visibility', () => (cookie.value === 'hidden' ? 'hidden' : 'shown'))
  const shown = computed(() => state.value === 'shown')
  function set(visible: boolean) {
    state.value = visible ? 'shown' : 'hidden'
    cookie.value = state.value
  }
  return { shown, set, toggle: () => set(!shown.value) }
}
