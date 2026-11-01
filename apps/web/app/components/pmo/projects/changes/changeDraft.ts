import { computed, ref } from 'vue'
import type { ProjectChange, ProjectChangeWrite } from '@liwan/contracts'

export const NO_CATEGORY = 'none'

/**
 * The editable state of one change request form. The write token is captured when the form opens (or is reloaded on
 * purpose), never from the live record: a refetch on window focus must not let a save overwrite another tab's edit.
 */
export function useChangeDraft(initial?: ProjectChange) {
  const read = (item?: ProjectChange) => ({
    title: item?.title ?? '',
    description: item?.description ?? '',
    reason: item?.reason ?? '',
    categoryId: item?.category ? String(item.category.id) : NO_CATEGORY,
    scheduleDays: item?.impact_schedule_days ?? 0,
    costInput: item ? String(item.impact_cost) : '0',
    impactScope: item?.impact_scope ?? '',
  })
  const start = read(initial)
  const title = ref(start.title)
  const description = ref(start.description)
  const reason = ref(start.reason)
  const categoryId = ref<string>(start.categoryId)
  const scheduleDays = ref<number | undefined>(start.scheduleDays)
  const costInput = ref(start.costInput)
  const impactScope = ref(start.impactScope)
  const token = ref(initial?.updated_at)
  const snapshot = () => JSON.stringify([title.value, description.value, reason.value, categoryId.value, scheduleDays.value, costInput.value, impactScope.value])
  const baseline = ref(snapshot())
  let initialCategory = start.categoryId

  const cost = computed(() => costInput.value.trim() === '' ? NaN : Number(costInput.value))
  const dirty = computed(() => snapshot() !== baseline.value)

  /** The request body: the category is sent only when the user changed it, so an archived one is never resent. */
  function body(): ProjectChangeWrite {
    return {
      title: title.value.trim(),
      description: description.value,
      reason: reason.value,
      ...(categoryId.value !== initialCategory ? { category_id: categoryId.value === NO_CATEGORY ? null : Number(categoryId.value) } : {}),
      impact_schedule_days: scheduleDays.value,
      impact_cost: cost.value,
      impact_scope: impactScope.value,
    }
  }

  /** Take the server's values and its token, on the user's explicit request. */
  function reload(item: ProjectChange) {
    const next = read(item)
    title.value = next.title
    description.value = next.description
    reason.value = next.reason
    categoryId.value = next.categoryId
    scheduleDays.value = next.scheduleDays
    costInput.value = next.costInput
    impactScope.value = next.impactScope
    token.value = item.updated_at
    initialCategory = next.categoryId
    baseline.value = snapshot()
  }

  return { title, description, reason, categoryId, scheduleDays, costInput, impactScope, token, cost, dirty, body, reload }
}
