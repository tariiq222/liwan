import { computed } from 'vue'
import { useSalesTemplate } from './useSalesTemplates'

/**
 * The template a record page (`/settings/apps/sales/templates/<id>` and its editor) shows: a route id that is not a
 * positive integer reads nothing and is a 404 state, and `canManage` holds only for a settings manager the server also
 * lets manage this template.
 */
export function useSalesTemplateRecord() {
  const route = useRoute()
  const { can } = useAccess()
  const id = computed(() => Number(route.params.id))
  const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
  const query = useSalesTemplate(computed(() => validId.value ? id.value : null))
  const template = computed(() => query.data.value)
  const loading = computed(() => validId.value && query.isLoading.value)
  const error = computed(() => validId.value ? query.error.value : { status: 404 })
  const canManage = computed(() => can('sales.settings.manage') && !!template.value?.can_manage)
  return { id, validId, query, template, loading, error, canManage }
}
