<script setup lang="ts">
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import type { PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'
import { refDebounced } from '@vueuse/core'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import PartnerTable from '@/components/finance/PartnerTable.vue'
import { FINANCE_PARTNER_KINDS, FINANCE_PARTNER_PAGE_SIZE, parsePartnerListQuery, partnerListQuery, type FinancePartnerListState } from '@/composables/finance/financePartnerParams'
import { useArchiveFinancePartner, useFinancePartners, useUnarchiveFinancePartner } from '@/composables/finance/useFinancePartners'

const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const { can } = useAccess()
const hydrated = useHydrated()
const canManage = computed(() => can('finance.partners.manage'))

const state = computed(() => parsePartnerListQuery(route.query))
const search = ref(state.value.q)
const debouncedSearch = refDebounced(search, 250)
const { data, isLoading, error, refetch } = useFinancePartners(computed(() => ({ ...state.value, limit: FINANCE_PARTNER_PAGE_SIZE })))

const items = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const page = computed(() => Math.floor(state.value.offset / FINANCE_PARTNER_PAGE_SIZE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / FINANCE_PARTNER_PAGE_SIZE)))
const showEmpty = computed(() => !isLoading.value && !error.value && items.value.length === 0)
const activeFilterCount = computed(() => Number(Boolean(state.value.q)) + Number(state.value.kind !== null))
const hasActiveFilters = computed(() => activeFilterCount.value > 0)
const headerTags = computed<PageHeaderTag[]>(() => data.value
  ? [{ label: t('finance.partners.count', { count: n(total.value) }, total.value), kind: 'count', testId: 'finance-partners-count' }]
  : [])

const kindItems = computed(() => [
  { value: 'all', label: t('finance.partners.kind.all') },
  ...FINANCE_PARTNER_KINDS.map(kind => ({ value: kind, label: t(`finance.partners.kind.${kind}s`) })),
])
const scopes = computed(() => [
  { value: 'active', label: t('finance.partners.status.active') },
  { value: 'archived', label: t('finance.partners.status.archived') },
])

// The create panel (partners/new.vue) is a child route over this same page, so filter changes only apply on the list itself.
function onList() { return (route.path.replace(/\/+$/, '') || '/') === '/finance/partners' }
function update(patch: Partial<FinancePartnerListState>) {
  if (!onList()) return
  void router.replace({ query: { ...route.query, ...partnerListQuery({ ...state.value, offset: 0, ...patch }) } })
}
watch(() => state.value.q, (q) => { search.value = q })
watch(debouncedSearch, (value) => { if (value.trim() !== state.value.q) update({ q: value.trim() }) })
function setKind(value: unknown) { update({ kind: FINANCE_PARTNER_KINDS.find(kind => kind === value) ?? null }) }
function setScope(value: string | number) { if (hydrated.value) update({ archived: value === 'archived' }) }
function clearSearch() { search.value = ''; update({ q: '' }) }
function clearFilters() { search.value = ''; update({ q: '', kind: null }) }
function setPage(next: number) {
  if (!hydrated.value || isLoading.value || next < 1 || next > pages.value) return
  update({ offset: (next - 1) * FINANCE_PARTNER_PAGE_SIZE })
}

// The create panel drops a referrer's returnTo and keeps only the list state, so the link carries the list state and nothing else.
const createTo = computed(() => {
  if (!canManage.value) return undefined
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/finance/partners/new', query: listQuery }
})
function editPartner(id: number) { void navigateTo({ path: `/finance/partners/${id}/edit`, query: returnToQuery(route.fullPath) }) }

const pendingId = ref<number | null>(null)
const pendingPartner = computed(() => items.value.find(item => item.id === pendingId.value) ?? null)
const { mutateAsync: archive, isPending: archiving } = useArchiveFinancePartner()
const { mutateAsync: unarchive, isPending: unarchiving } = useUnarchiveFinancePartner()
const archivePending = computed(() => archiving.value || unarchiving.value)
const archiveError = ref<unknown>(null)
function cancelArchive() { pendingId.value = null; archiveError.value = null }
async function confirmArchive() {
  const partner = pendingPartner.value
  if (!partner || !hydrated.value || archivePending.value) return
  try {
    if (partner.active) await archive(partner.id)
    else await unarchive(partner.id)
    cancelArchive()
  } catch (failure) { archiveError.value = failure }
}
</script>

<template>
  <SharedListPage
    :title="t('finance.partners.title')"
    :tags="headerTags"
    :create-to="createTo"
    :create-label="t('finance.nav.newPartner')"
    create-test-id="finance-partner-new"
  >
    <SharedListCard>
      <template #filters>
        <div class="w-full min-w-0">
          <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
            <template #search>
              <UInput v-model="search" :disabled="!hydrated" :placeholder="t('finance.partners.search')" :aria-label="t('finance.partners.search')" icon="i-lucide-search" class="min-w-48 flex-1" />
            </template>
            <template #default>
              <SharedFilterChoice
                data-testid="finance-partners-kind-filter"
                :label="t('finance.partners.columns.kind')"
                :items="kindItems"
                :model-value="state.kind ?? 'all'"
                :disabled="!hydrated"
                @update:model-value="setKind"
              />
            </template>
            <template #view>
              <SharedSegmentedControl data-testid="finance-partners-scope" :label="t('finance.partners.columns.status')" :items="scopes" :model-value="state.archived ? 'archived' : 'active'" @update:model-value="setScope" />
            </template>
            <template #active>
              <div v-if="hasActiveFilters" class="flex flex-wrap items-center gap-2">
                <SharedFilterChip v-if="state.q" :label="t('finance.partners.searchValue', { value: state.q })" @remove="clearSearch" />
                <SharedFilterChip v-if="state.kind" :label="t(`finance.partners.kind.${state.kind}s`)" @remove="setKind('all')" />
              </div>
            </template>
          </FilterBar>
        </div>
      </template>

      <SharedInlineConfirm
        v-if="pendingPartner"
        class="m-(--webvue-card-pad-dense)"
        :color="pendingPartner.active ? 'error' : 'primary'"
        :title="t(pendingPartner.active ? 'finance.partners.archiveConfirm' : 'finance.partners.unarchiveConfirm', { name: pendingPartner.name })"
        :description="archiveError ? t('errors.generic') : t('finance.partners.archiveHint')"
        :confirm-label="pendingPartner.active ? t('finance.partners.archive') : t('finance.partners.unarchive')"
        :pending="archivePending"
        @confirm="confirmArchive"
        @cancel="cancelArchive"
      />

      <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t(hasActiveFilters ? 'finance.partners.filteredEmpty' : state.archived ? 'finance.partners.emptyArchived' : 'finance.partners.empty')" :description="hasActiveFilters ? t('finance.partners.filteredEmptyHint') : undefined">
        <template v-if="hasActiveFilters" #action><UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('finance.partners.clear')" @click="clearFilters" /></template>
      </SharedEmptyState>
      <PartnerTable v-else :rows="items" :loading="isLoading" :error="error" :can-manage="canManage" @edit="editPartner" @archive="pendingId = $event" @retry="refetch" />

      <template v-if="data && !showEmpty" #footer>
        <SharedListFooter :count-label="t('finance.partners.footer', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="isLoading" @update:page="setPage" />
      </template>
    </SharedListCard>
  </SharedListPage>
</template>
