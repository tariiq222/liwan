<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { partnerKinds } from '@/composables/finance/financePartnerParams'
import type { FinancePartner } from '@/composables/finance/useFinancePartners'

// The rows of the partners list. The page owns the query, filters and paging; this renders the loaded page.
const props = defineProps<{ rows: FinancePartner[]; loading: boolean; error: unknown; canManage: boolean }>()
const emit = defineEmits<{ edit: [id: number]; archive: [id: number]; retry: [] }>()
const { t } = useI18n()
const route = useRoute()

const NAME_LINK = 'block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
const WIDTH = {
  name: 'min-w-[240px]',
  kind: 'w-[176px] min-w-[176px]',
  vat: 'w-[176px] min-w-[176px]',
  place: 'w-[176px] min-w-[176px]',
  status: 'w-[112px] min-w-[112px]',
  actions: 'w-[56px] min-w-[56px]',
}
function column(id: string, header: string, width: string, fit = true): TableColumn<FinancePartner> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<FinancePartner>['meta'] }
}
const columns = computed<TableColumn<FinancePartner>[]>(() => [
  column('name', t('finance.partners.columns.name'), WIDTH.name, false),
  column('kind', t('finance.partners.columns.kind'), WIDTH.kind),
  column('vat', t('finance.partners.columns.vat'), WIDTH.vat),
  column('place', t('finance.partners.columns.place'), WIDTH.place, false),
  column('status', t('finance.partners.columns.status'), WIDTH.status),
  ...(props.canManage ? [column('actions', t('finance.partners.columns.actions'), WIDTH.actions)] : []),
])

function partnerTo(id: number) { return { path: `/finance/partners/${id}`, query: returnToQuery(route.fullPath) } }
function place(partner: FinancePartner) { return [partner.city, partner.country?.name].filter(Boolean).join(' · ') }
function actionsFor(partner: FinancePartner): RowAction[] {
  return [
    { label: t('finance.partners.edit'), icon: 'i-lucide-pencil', onSelect: () => emit('edit', partner.id) },
    {
      label: partner.active ? t('finance.partners.archive') : t('finance.partners.unarchive'),
      icon: partner.active ? 'i-lucide-archive' : 'i-lucide-archive-restore',
      destructive: partner.active,
      onSelect: () => emit('archive', partner.id),
    },
  ]
}
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,864px)] [&_table]:table-fixed">
    <SharedDataTable
      bare
      :rows="rows"
      :columns="columns"
      row-key="id"
      :row-to="(row: FinancePartner) => partnerTo(row.id)"
      :loading="loading"
      :error="error"
      :caption="t('finance.partners.title')"
      @retry="emit('retry')"
    >
      <template #name-cell="{ row }">
        <NuxtLink :to="partnerTo(row.original.id)" :class="NAME_LINK" data-testid="finance-partner-name">{{ row.original.name }}</NuxtLink>
        <p v-if="row.original.company_registry" class="truncate text-xs text-muted">{{ row.original.company_registry }}</p>
      </template>
      <template #kind-cell="{ row }">
        <div class="flex flex-wrap gap-1">
          <SharedStatusBadge v-for="kind in partnerKinds(row.original)" :key="kind" size="sm" :tone="kind === 'customer' ? 'info' : 'neutral'" :label="t(`finance.partners.kind.${kind}`)" />
        </div>
      </template>
      <template #vat-cell="{ row }"><bdi v-if="row.original.vat" dir="ltr">{{ row.original.vat }}</bdi><template v-else><span aria-hidden="true" class="text-muted">—</span><span class="sr-only">{{ t('states.noValue') }}</span></template></template>
      <template #place-cell="{ row }"><template v-if="place(row.original)">{{ place(row.original) }}</template><template v-else><span aria-hidden="true" class="text-muted">—</span><span class="sr-only">{{ t('states.noValue') }}</span></template></template>
      <template #status-cell="{ row }"><SharedStatusBadge size="sm" :tone="row.original.active ? 'success' : 'neutral'" :label="t(row.original.active ? 'finance.partners.status.active' : 'finance.partners.status.archived')" /></template>
      <template v-if="canManage" #actions-cell="{ row }">
        <div class="flex justify-end"><SharedRowActions :actions="actionsFor(row.original)" :label="t('finance.partners.rowActions', { name: row.original.name })" /></div>
      </template>
      <template #mobile-row="{ row }">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <NuxtLink :to="partnerTo(row.id)" :class="NAME_LINK" data-testid="finance-partner-name">{{ row.name }}</NuxtLink>
            <p v-if="row.vat" class="truncate text-xs text-muted"><bdi dir="ltr">{{ row.vat }}</bdi></p>
            <p v-if="place(row)" class="mt-1 truncate text-xs text-muted">{{ place(row) }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <SharedStatusBadge v-for="kind in partnerKinds(row)" :key="kind" size="sm" :tone="kind === 'customer' ? 'info' : 'neutral'" :label="t(`finance.partners.kind.${kind}`)" />
            <SharedRowActions v-if="canManage" :actions="actionsFor(row)" :label="t('finance.partners.rowActions', { name: row.name })" />
          </div>
        </div>
      </template>
    </SharedDataTable>
  </div>
</template>
