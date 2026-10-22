import { computed } from 'vue'

/** Personal HR cache scopes follow identity synchronously; access-refresh cancellation is asynchronous. */
export function useHrOwnIdentity() {
  const { me } = useMe()
  const scope = computed(() => ({ companyId: me.value?.company.id ?? null, userId: me.value?.id ?? null }))
  const ready = computed(() => !!scope.value.companyId && !!scope.value.userId)
  return { scope, ready }
}
