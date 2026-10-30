<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceJournal } from '@liwan/contracts'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import { h } from 'vue'
import { useArchiveSetupJournal, useSetupJournals } from '@/composables/finance/useFinanceRecords'
import JournalEditor from './JournalEditor.vue'
import RecordArchiveConfirm from './RecordArchiveConfirm.vue'
import RecordsFilters from './RecordsFilters.vue'
import { JOURNAL_TYPES } from './recordForms'
import { useRecordList } from './useRecordList'

// The journals of the current company: type and archived filters in the URL (the API has no search), a page of journals, and the
// inline editor or confirmation above it. There is no delete; an archived journal can be brought back.
const { t } = useI18n()
const { can } = useAccess()
const canManage = computed(() => can('finance.journals.manage'))
const list = useRecordList<FinanceJournal>({ fallbackPath: '/settings/apps/finance/journals', kinds: [...JOURNAL_TYPES, 'credit'], kindParam: 'type', searchable: false, list: params => useSetupJournals(params) })
const { mutateAsync: send, isPending: archiving } = useArchiveSetupJournal()

type Panel = { kind: 'create' } | { kind: 'edit' | 'archive'; journal: FinanceJournal }
const panel = ref<Panel | null>(null)
const panelKey = (value: Panel) => value.kind === 'create' ? 'create' : `${value.kind}-${value.journal.id}`
const kinds = computed(() => [...JOURNAL_TYPES, 'credit' as const].map(type => ({ value: type, label: t(`financeRecords.journals.types.${type}`) })))

const columns = computed<TableColumn<FinanceJournal>[]>(() => [
  { id: 'code', header: t('financeRecords.journals.columns.code') },
  { id: 'name', header: t('financeRecords.journals.columns.name') },
  { id: 'type', header: t('financeRecords.journals.columns.type') },
  { id: 'default_account', header: t('financeRecords.journals.columns.defaultAccount') },
  { id: 'state', header: t('financeRecords.columns.state') },
  ...(canManage.value ? [{ id: 'actions', header: () => h('span', { class: 'sr-only' }, t('app.actions')), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } }] : []),
])
const dash = computed(() => t('app.notAvailable'))
const stateTone = (journal: FinanceJournal) => journal.active ? 'success' : 'neutral'
const stateLabel = (journal: FinanceJournal) => t(`financeRecords.states.${journal.active ? 'active' : 'archived'}`)
const actions = (journal: FinanceJournal): RowAction[] => [
  { label: t('financeRecords.actions.edit'), icon: 'i-lucide-pencil', onSelect: () => { panel.value = { kind: 'edit', journal } } },
  { label: t(`financeRecords.actions.${journal.active ? 'archive' : 'unarchive'}`), icon: journal.active ? 'i-lucide-archive' : 'i-lucide-archive-restore', onSelect: () => { panel.value = { kind: 'archive', journal } } },
]
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('financeRecords.journals.title')" :description="t('financeRecords.journals.description')" data-testid="finance-record-journals">
    <template v-if="canManage" #actions>
      <UButton color="primary" icon="i-lucide-plus" :disabled="!list.hydrated.value || panel !== null" :label="t('financeRecords.journals.new')" data-testid="finance-record-journal-new" @click="panel = { kind: 'create' }" />
    </template>
    <div class="grid gap-(--liwan-gap-card)">
      <template v-if="panel">
        <RecordArchiveConfirm v-if="panel.kind === 'archive'" :key="panelKey(panel)" scope="journals" :name="panel.journal.name" :active="panel.journal.active" :pending="archiving" :send="archive => send({ id: (panel as { journal: FinanceJournal }).journal.id, archive })" @done="panel = null" @cancel="panel = null" />
        <JournalEditor v-else :key="panelKey(panel)" :journal="panel.kind === 'edit' ? panel.journal : undefined" @done="panel = null" @cancel="panel = null" />
      </template>
      <RecordsFilters
        id-prefix="finance-record-journals" :filters="list.filters.value" :active-count="list.activeCount.value" :hydrated="list.hydrated.value"
        :kinds="kinds" :kind-label="t('financeRecords.journals.columns.type')" :all-label="t('financeRecords.journals.allTypes')"
        @clear="list.clearFilters" @kind="list.setKind" @state="list.setState"
      />
      <SharedPageState :error="list.query.error.value" :keep-content="list.items.value.length > 0" @retry="list.query.refetch">
        <SharedEmptyState v-if="list.showEmpty.value" :title="t(list.activeCount.value ? 'app.noResults' : 'financeRecords.journals.empty')" />
        <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,640px)]">
          <SharedDataTable bare :rows="list.items.value" :columns="columns" row-key="id" :loading="list.query.isPending.value" :caption="t('financeRecords.journals.title')">
            <template #code-cell="{ row }"><bdi class="font-semibold tabular-nums text-highlighted" dir="ltr">{{ row.original.code }}</bdi></template>
            <template #name-cell="{ row }">{{ row.original.name }}</template>
            <template #type-cell="{ row }"><SharedStatusBadge size="sm" tone="neutral" :label="t(`financeRecords.journals.types.${row.original.type}`)" /></template>
            <template #default_account-cell="{ row }">{{ row.original.default_account?.name ?? dash }}</template>
            <template #state-cell="{ row }"><SharedStatusBadge size="sm" :tone="stateTone(row.original)" :label="stateLabel(row.original)" /></template>
            <template #actions-cell="{ row }">
              <SharedRowActions :actions="actions(row.original)" :label="t('financeRecords.journals.actionsNamed', { name: row.original.name })" :disabled="!list.hydrated.value || panel !== null" />
            </template>
            <template #mobile-row="{ row }">
              <div class="flex min-w-0 items-start justify-between gap-2" :data-testid="`finance-record-journal-${row.id}`">
                <div class="flex min-w-0 flex-col gap-1">
                  <span class="truncate font-semibold text-highlighted"><bdi dir="ltr">{{ row.code }}</bdi> {{ row.name }}</span>
                  <span class="text-sm text-muted">{{ t(`financeRecords.journals.types.${row.type}`) }}</span>
                  <SharedStatusBadge size="sm" class="w-fit" :tone="stateTone(row)" :label="stateLabel(row)" />
                </div>
                <SharedRowActions v-if="canManage" :actions="actions(row)" :label="t('financeRecords.journals.actionsNamed', { name: row.name })" :disabled="!list.hydrated.value || panel !== null" />
              </div>
            </template>
          </SharedDataTable>
        </div>
      </SharedPageState>
      <SharedListFooter v-if="list.query.data.value && !list.showEmpty.value" :count-label="t('financeRecords.journals.footer', { shown: list.items.value.length, total: list.total.value }, list.total.value)" :page="list.filters.value.page" :pages="list.pages.value" :disabled="!list.hydrated.value || list.query.isFetching.value" count-test-id="finance-record-journal-count" @update:page="list.setPage" />
    </div>
  </SharedRecordSection>
</template>
