<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceAccount } from '@webvue/contracts'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'
import { h } from 'vue'
import { useArchiveSetupAccount, useSetupAccounts } from '@/composables/finance/useFinanceRecords'
import { ACCOUNT_TYPES } from '../accounting/accountListParams'
import AccountEditor from './AccountEditor.vue'
import RecordArchiveConfirm from './RecordArchiveConfirm.vue'
import RecordsFilters from './RecordsFilters.vue'
import { useRecordList } from './useRecordList'

// The chart of accounts of the current company: search, type and archived filters in the URL, a page of accounts, and the inline
// editor or confirmation above it. There is no delete; an archived account can be brought back.
const { t } = useI18n()
const { can } = useAccess()
const canManage = computed(() => can('finance.accounts.manage'))
const list = useRecordList<FinanceAccount>({ fallbackPath: '/settings/apps/finance/accounts', kinds: ACCOUNT_TYPES, kindParam: 'account_type', list: params => useSetupAccounts(params) })
const { mutateAsync: send, isPending: archiving } = useArchiveSetupAccount()

type Panel = { kind: 'create' } | { kind: 'edit' | 'archive'; account: FinanceAccount }
const panel = ref<Panel | null>(null)
const panelKey = (value: Panel) => value.kind === 'create' ? 'create' : `${value.kind}-${value.account.id}`
const kinds = computed(() => ACCOUNT_TYPES.map(type => ({ value: type, label: t(`financeAccounting.accountTypes.${type}`) })))

const columns = computed<TableColumn<FinanceAccount>[]>(() => [
  { id: 'code', header: t('financeRecords.accounts.columns.code') },
  { id: 'name', header: t('financeRecords.accounts.columns.name') },
  { id: 'account_type', header: t('financeRecords.accounts.columns.type') },
  { id: 'state', header: t('financeRecords.columns.state') },
  ...(canManage.value ? [{ id: 'actions', header: () => h('span', { class: 'sr-only' }, t('app.actions')), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } }] : []),
])
const stateTone = (account: FinanceAccount) => account.active ? 'success' : 'neutral'
const stateLabel = (account: FinanceAccount) => t(`financeRecords.states.${account.active ? 'active' : 'archived'}`)
const actions = (account: FinanceAccount): RowAction[] => [
  { label: t('financeRecords.actions.edit'), icon: 'i-lucide-pencil', onSelect: () => { panel.value = { kind: 'edit', account } } },
  { label: t(`financeRecords.actions.${account.active ? 'archive' : 'unarchive'}`), icon: account.active ? 'i-lucide-archive' : 'i-lucide-archive-restore', onSelect: () => { panel.value = { kind: 'archive', account } } },
]
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('financeRecords.accounts.title')" :description="t('financeRecords.accounts.description')" data-testid="finance-record-accounts">
    <template v-if="canManage" #actions>
      <UButton color="primary" icon="i-lucide-plus" :disabled="!list.hydrated.value || panel !== null" :label="t('financeRecords.accounts.new')" data-testid="finance-record-account-new" @click="panel = { kind: 'create' }" />
    </template>
    <div class="grid gap-(--webvue-gap-card)">
      <template v-if="panel">
        <RecordArchiveConfirm v-if="panel.kind === 'archive'" :key="panelKey(panel)" scope="accounts" :name="panel.account.name" :active="panel.account.active" :pending="archiving" :send="archive => send({ id: (panel as { account: FinanceAccount }).account.id, archive })" @done="panel = null" @cancel="panel = null" />
        <AccountEditor v-else :key="panelKey(panel)" :account="panel.kind === 'edit' ? panel.account : undefined" @done="panel = null" @cancel="panel = null" />
      </template>
      <RecordsFilters
        id-prefix="finance-record-accounts" :filters="list.filters.value" :active-count="list.activeCount.value" :hydrated="list.hydrated.value"
        :search="list.search.value" :search-placeholder="t('financeRecords.accounts.search')" :kinds="kinds" :kind-label="t('financeRecords.accounts.columns.type')" :all-label="t('financeAccounting.filters.allTypes')"
        @update:search="value => { list.search.value = value }" @submit="list.submitSearch" @clear="list.clearFilters" @kind="list.setKind" @state="list.setState"
      />
      <SharedPageState :error="list.query.error.value" :keep-content="list.items.value.length > 0" @retry="list.query.refetch">
        <SharedEmptyState v-if="list.showEmpty.value" :title="t(list.activeCount.value ? 'app.noResults' : 'financeRecords.accounts.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,640px)]">
          <SharedDataTable bare :rows="list.items.value" :columns="columns" row-key="id" :loading="list.query.isPending.value" :caption="t('financeRecords.accounts.title')">
            <template #code-cell="{ row }"><bdi class="font-semibold tabular-nums text-highlighted" dir="ltr">{{ row.original.code }}</bdi></template>
            <template #name-cell="{ row }">{{ row.original.name }}</template>
            <template #account_type-cell="{ row }"><SharedStatusBadge size="sm" tone="neutral" :label="t(`financeAccounting.accountTypes.${row.original.account_type}`)" /></template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="stateTone(row.original)" :label="stateLabel(row.original)" /></template>
            <template #actions-cell="{ row }">
              <SharedRowActions :actions="actions(row.original)" :label="t('financeRecords.accounts.actionsNamed', { name: row.original.name })" :disabled="!list.hydrated.value || panel !== null" />
            </template>
            <template #mobile-row="{ row }">
              <div class="flex min-w-0 items-start justify-between gap-2" :data-testid="`finance-record-account-${row.id}`">
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="truncate font-semibold text-highlighted"><bdi dir="ltr" class="tabular-nums">{{ row.code }}</bdi> {{ row.name }}</span>
                  <span class="text-sm text-muted">{{ t(`financeAccounting.accountTypes.${row.account_type}`) }}</span>
                  <SharedStatusBadge size="sm" class="w-fit" :tone="stateTone(row)" :label="stateLabel(row)" />
                </div>
                <SharedRowActions v-if="canManage" :actions="actions(row)" :label="t('financeRecords.accounts.actionsNamed', { name: row.name })" :disabled="!list.hydrated.value || panel !== null" />
              </div>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <SharedListFooter v-if="list.query.data.value && !list.showEmpty.value" :count-label="t('financeRecords.accounts.footer', { shown: list.items.value.length, total: list.total.value }, list.total.value)" :page="list.filters.value.page" :pages="list.pages.value" :disabled="!list.hydrated.value || list.query.isFetching.value" count-test-id="finance-record-account-count" @update:page="list.setPage" />
    </div>
  </SharedRecordSection>
</template>
