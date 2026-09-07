<script setup lang="ts">
import { useProjectStakeholders, useDeleteProjectStakeholder } from '@/composables/useProjectGovernance'
import { governanceFilters } from '@/components/project/governance/state'
import { ApiError } from '@/composables/useApi'
const route = useRoute(); const router = useRouter(); const { t } = useI18n(); const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const parsed = computed(() => governanceFilters(route.query))
const filters = computed(() => ({ q: parsed.value.q, limit: 50, offset: parsed.value.offset }))
const list = useProjectStakeholders(id, filters); const remove = useDeleteProjectStakeholder()
const confirmDeleteId = ref<number | null>(null); const error = ref<string | null>(null)
const returnTo = computed(() => route.fullPath)
function setFilter(key: string, value: string) { router.replace({ query: { ...route.query, [key]: value || undefined, offset: undefined } }) }
const q = computed({ get: () => typeof route.query.q === 'string' ? route.query.q : '', set: value => setFilter('q', value) })
function page(delta: number) { router.push({ query: { ...route.query, offset: String(Math.max(0, (parsed.value.offset ?? 0) + delta * 50)) } }) }
async function deleteItem(item: { id: number }) {
  error.value = null
  if (confirmDeleteId.value !== item.id) { confirmDeleteId.value = item.id; return }
  try { await remove.mutateAsync({ projectId: id.value, id: item.id }); confirmDeleteId.value = null }
  catch (cause) { error.value = cause instanceof ApiError && cause.code === 'stakeholder_assigned' ? t('projects.governance.stakeholderAssigned') : cause instanceof ApiError ? cause.message : t('errors.generic') }
}
</script>
<template><SharedPageContainer width="list"><SharedPageHeader :title="t('projects.governance.stakeholders')" :back-to="`/projects/${id}`" /><div class="flex flex-wrap items-center gap-3"><Input :aria-label="t('app.search')" :disabled="!hydrated" v-model="q" class="max-w-sm" :placeholder="t('app.search')" /><NuxtLink v-if="list.data.value?.can_manage && hydrated" :to="{ path: `/projects/${id}/stakeholders/new`, query: { returnTo } }"><Button>{{ t('app.create') }}</Button></NuxtLink></div><p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p><SharedPageState :loading="list.isLoading.value" :error="list.error.value" :empty="!list.isLoading.value && !list.data.value?.items.length" @retry="list.refetch" /><section v-if="list.data?.value?.items.length" class="nasq-panel overflow-x-auto"><table class="w-full text-start text-sm"><thead><tr class="border-b"><th class="p-3 text-start">{{ t('projects.governance.stakeholder.name') }}</th><th class="p-3 text-start">{{ t('projects.governance.stakeholder.organization') }}</th><th class="p-3 text-start">{{ t('projects.governance.stakeholder.role') }}</th><th class="p-3 text-start" /></tr></thead><tbody><tr v-for="item in list.data.value.items" :key="item.id" class="border-b last:border-0"><td class="p-3"><NuxtLink class="font-medium underline" :to="{ path: `/projects/${id}/stakeholders/${item.id}`, query: { returnTo } }">{{ item.name }}</NuxtLink></td><td class="p-3">{{ item.organization || '—' }}</td><td class="p-3">{{ item.role || '—' }}</td><td v-if="list.data.value.can_manage" class="p-3 text-end"><Button variant="ghost" size="sm" :disabled="!hydrated || remove.isPending.value" @click="deleteItem(item)">{{ confirmDeleteId === item.id ? t('projects.governance.confirmDeleteAction') : t('projects.governance.delete') }}</Button><Button v-if="confirmDeleteId === item.id" variant="outline" size="sm" :disabled="!hydrated || remove.isPending.value" @click="confirmDeleteId = null">{{ t('app.cancel') }}</Button></td></tr></tbody></table></section><nav v-if="list.data.value" class="flex items-center gap-3" :aria-label="t('projects.governance.pagination')"><Button variant="outline" :disabled="!hydrated || list.isFetching.value || !parsed.offset" @click="page(-1)">{{ t('projects.governance.previous') }}</Button><span>{{ t('projects.governance.total', { total: list.data.value.total }) }}</span><Button variant="outline" :disabled="!hydrated || list.isFetching.value || (parsed.offset ?? 0) + 50 >= list.data.value.total" @click="page(1)">{{ t('projects.governance.next') }}</Button></nav></SharedPageContainer></template>
