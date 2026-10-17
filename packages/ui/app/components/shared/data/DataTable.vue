<script setup lang="ts" generic="T extends object">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import { useRowNavigation } from '../../../composables/useRowNavigation'
import { clickedRowIndex, dataRowKey, markTableRows, rowSelectionState, selectedFromRowSelection } from '../../../utils/dataTable'
import PageState from '../feedback/PageState.vue'
import Pagination from './Pagination.vue'

/*
 * The list template's table (Tasmim spec §6, template 1): filters, a bulk bar, UTable on wide
 * screens, the caller's mobile rows on phones, the shared states and pagination. Rows follow the
 * J / K contract (data-shortcut-row + useRowNavigation), which reads keys on the document: one
 * DataTable per page. The `mobile-row` slot carries its own selection control if one is needed.
 * The selected count (and `bulk`'s `selected`) includes keys selected on other pages.
 * The table sits in one card (18px radius, hairline ring). `density` picks the variant: `dense` (lists, the
 * default) pads cells 16px on a 44px row, `comfortable` (home and overview pages) 20px on a 52px row.
 * `embeddedFilters` moves the `filters` slot into the card's header (one calm row, a hairline below it);
 * the loading and empty states then sit inside that same card. The `footer` slot is the card's last row,
 * shown with the table (a result count and a load-more or paging control); `emptyAction` is the empty state's action.
 */
const props = withDefaults(defineProps<{
  rows: T[]
  columns: TableColumn<T>[]
  loading?: boolean
  error?: unknown
  emptyText?: string
  rowKey: keyof T | ((row: T) => string | number)
  rowTo?: (row: T) => RouteLocationRaw
  page?: number
  pages?: number
  selectable?: boolean
  selected?: (string | number)[]
  /** The table's accessible name (sr-only caption) and the mobile list's label. */
  caption?: string
  density?: 'dense' | 'comfortable'
  embeddedFilters?: boolean
}>(), {
  loading: false,
  density: 'dense',
  embeddedFilters: false,
  selectable: false,
  selected: () => [],
})
const emit = defineEmits<{ 'update:page': [page: number]; 'update:selected': [keys: (string | number)[]]; retry: [] }>()
const slots = useSlots()
const { t } = useI18n()
const hydrated = useHydrated()
const body = ref<HTMLElement | null>(null)
const tableHost = ref<HTMLElement | null>(null)
useRowNavigation(body)

const tableColumns = computed<TableColumn<T>[]>(() => props.selectable
  ? [{ id: 'select', enableSorting: false, enableHiding: false, meta: { class: { td: 'webvue-select-cell' } } }, ...props.columns]
  : props.columns)
// Cells pad with the card padding and rows take the row height (app.config table recipe): density swaps those two tokens.
const densityClass = computed(() => props.density === 'dense'
  ? '[--webvue-card-pad:var(--webvue-card-pad-dense)]'
  : '[--webvue-row-h:var(--webvue-row-h-comfortable)]')
// The ring and radius sit on the card around the table, or on the card around the filters when they are embedded.
const surfaceClass = 'overflow-hidden rounded-card bg-default ring ring-default'
const rowId = (row: T) => String(dataRowKey(row, props.rowKey))
const rowSelection = computed({
  get: () => rowSelectionState(props.selected),
  set: (state: Record<string, boolean>) => emit('update:selected', selectedFromRowSelection(state, props.rows, props.rowKey, props.selected)),
})
// Scoped to body rows: UTable's `ui.tr` would also style the header and footer rows.
const rowClass = computed(() => [
  '[&_tbody_tr]:outline-none [&_tbody_tr:focus-visible]:bg-elevated/60 [&_tbody_tr:focus-visible]:outline-2',
  '[&_tbody_tr:focus-visible]:-outline-offset-2 [&_tbody_tr:focus-visible]:outline-primary [&_tbody_tr[data-selected=true]>*]:text-default',
  props.rowTo ? '[&_tbody_tr]:cursor-pointer' : '',
].join(' '))

// With rowTo, the first column links to the record when it reads a value (accessorKey / accessorFn) and
// has no `cell` renderer of its own and no `#<column>-cell` slot. Otherwise the caller renders the link in that cell.
const primaryColumn = computed(() => {
  const column = props.columns[0] as { id?: string; accessorKey?: string; accessorFn?: unknown; cell?: unknown } | undefined
  if (!column || column.cell || !(column.accessorKey || column.accessorFn)) return undefined
  return column.id ?? column.accessorKey
})
const linkSlot = computed(() => props.rowTo && primaryColumn.value && !slots[`${primaryColumn.value}-cell`] ? `${primaryColumn.value}-cell` : null)
function cellSlotNames() {
  return Object.keys(slots).filter(name => name.endsWith('-cell'))
}

// UTable takes no row attributes (Table.vue:316-322), so its rendered rows are marked after each patch.
function markRows() {
  void nextTick(() => { if (tableHost.value) markTableRows(tableHost.value) })
}

function onClick(event: MouseEvent) {
  if (!hydrated.value || !props.rowTo || event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  if (window.getSelection()?.toString()) return
  const index = clickedRowIndex(event.target)
  const row = index === null ? undefined : props.rows[index]
  if (row) void navigateTo(props.rowTo(row))
}

function clear() {
  emit('update:selected', [])
}
</script>

<template>
  <div data-slot="data-table" class="grid min-w-0 gap-(--webvue-gap-card)">
    <div v-if="$slots.filters && !props.embeddedFilters" data-slot="data-table-filters" class="min-w-0"><slot name="filters" /></div>
    <div
      v-if="props.selectable && props.selected.length > 0 && $slots.bulk"
      role="toolbar"
      data-slot="data-table-bulk"
      :aria-label="t('states.bulkActions')"
      class="flex flex-wrap items-center gap-2 rounded-control bg-elevated px-3 py-2 ring ring-default"
    >
      <span class="text-sm font-medium text-highlighted tabular-nums">{{ t('states.selectedCount', { count: props.selected.length }) }}</span>
      <slot name="bulk" :selected="props.selected" :clear="clear" />
      <UButton type="button" color="neutral" variant="ghost" size="sm" class="ms-auto" :disabled="!hydrated" @click="clear">{{ t('states.clearSelection') }}</UButton>
    </div>
    <div :class="props.embeddedFilters ? `min-w-0 ${surfaceClass}` : 'contents'" :data-embedded-filters="props.embeddedFilters || undefined">
      <div v-if="$slots.filters && props.embeddedFilters" data-slot="data-table-filters" class="min-w-0 border-b border-default px-(--webvue-card-pad-dense) py-3"><slot name="filters" /></div>
      <PageState :loading="props.loading && !props.rows.length" :error="props.error" :keep-content="props.rows.length > 0" :empty="props.rows.length === 0" :empty-text="props.emptyText" @retry="emit('retry')">
        <template v-if="$slots.emptyAction" #emptyAction><slot name="emptyAction" /></template>
        <div ref="body" data-slot="data-table-body" class="min-w-0" @click="onClick">
          <div :class="[props.embeddedFilters ? '' : surfaceClass, densityClass]" :data-density="props.density">
            <div ref="tableHost" class="overflow-x-auto" :class="{ 'hidden md:block': $slots['mobile-row'] }">
              <UTable
                v-model:row-selection="rowSelection"
                :data="props.rows"
                :columns="tableColumns"
                :get-row-id="rowId"
                :caption="props.caption"
                :ui="{ caption: 'sr-only' }"
                :class="rowClass"
                @vue:mounted="markRows"
                @vue:updated="markRows"
              >
                <template v-if="props.selectable" #select-header="{ table }">
                  <UCheckbox
                    :model-value="table.getIsSomePageRowsSelected() ? 'indeterminate' : table.getIsAllPageRowsSelected()"
                    :aria-label="t('states.selectAll')"
                    :disabled="!hydrated"
                    @update:model-value="(value: boolean | 'indeterminate') => table.toggleAllPageRowsSelected(value === true)"
                  />
                </template>
                <template v-if="props.selectable" #select-cell="{ row }">
                  <UCheckbox
                    :model-value="row.getIsSelected()"
                    :aria-label="t('states.selectRow')"
                    :disabled="!hydrated"
                    @update:model-value="(value: boolean | 'indeterminate') => row.toggleSelected(value === true)"
                  />
                </template>
                <template v-if="linkSlot" #[linkSlot]="{ row }">
                  <NuxtLink
                    :to="props.rowTo!(row.original)"
                    class="rounded font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >{{ row.getValue(primaryColumn!) }}</NuxtLink>
                </template>
                <template v-for="name in cellSlotNames()" :key="name" #[name]="cell">
                  <slot :name="name" v-bind="cell" />
                </template>
              </UTable>
            </div>
            <ul
              v-if="$slots['mobile-row']"
              class="divide-y divide-default md:hidden"
              :aria-label="props.caption"
            >
              <li
                v-for="(row, index) in props.rows"
                :key="rowId(row)"
                data-shortcut-row
                :data-row-index="index"
                tabindex="-1"
                class="p-4 outline-none focus-visible:bg-elevated/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                :class="{ 'cursor-pointer': props.rowTo }"
              >
                <slot name="mobile-row" :row="row" />
              </li>
            </ul>
            <div v-if="$slots.footer" data-slot="data-table-footer" class="flex flex-wrap items-center justify-between gap-3 border-t border-default px-(--webvue-card-pad) py-3 text-sm text-muted">
              <slot name="footer" />
            </div>
          </div>
        </div>
      </PageState>
    </div>
    <Pagination
      v-if="props.page !== undefined && props.pages !== undefined"
      :page="props.page"
      :pages="props.pages"
      :disabled="props.loading"
      @update:page="value => emit('update:page', value)"
    />
  </div>
</template>
