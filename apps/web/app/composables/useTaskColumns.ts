import { computed } from 'vue'
import { parseTaskColumns, TASK_COLUMNS_COOKIE, taskColumnOptions, toggleTaskColumn, visibleTaskColumns, type TaskColumnId, type TaskTableVariant } from './taskColumns'

/**
 * The visible columns of the task table, per browser (a cookie, like the KPI strips and the rail pins) and shared by the
 * toolbar's «الأعمدة» menu and the table, so a change shows at once. Read during SSR, so the first paint is already right.
 */
export function useTaskColumns(variant: TaskTableVariant) {
  const cookie = useCookie<string | null>(TASK_COLUMNS_COOKIE, { default: () => null, path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
  const chosen = useState<TaskColumnId[]>('task-columns', () => parseTaskColumns(cookie.value))
  const options = taskColumnOptions(variant)
  const visible = computed(() => visibleTaskColumns(variant, chosen.value))
  function set(id: TaskColumnId, on: boolean) {
    chosen.value = toggleTaskColumn(chosen.value, id, on)
    cookie.value = chosen.value.join(',')
  }
  return { options, visible, set }
}
