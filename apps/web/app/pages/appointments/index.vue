<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AppointmentBookingRow, AppointmentBookingState } from '@liwan/contracts'
import { formatDateTime, localIsoDay } from '@liwan/ui/app/utils/formatDate'
import { kpiLink } from '@liwan/ui/app/utils/kpiLink'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { useAppointmentBookings, useAppointmentTypes } from '@/composables/appointments/useAppointments'
import { useAppointmentListKpis } from '@/composables/appointments/useAppointmentKpis'
import { appointmentStateTone } from '@/utils/appointmentKpis'
import { APPOINTMENT_PAGE_SIZE, appointmentListQuery } from '@/utils/appointmentList'
import { lastPageOffset, parseOffset } from '@/utils/routeQuery'

// The staff bookings list: the appointments of the chosen day, KPI summary strip from limit=1 totals,
// two-row embedded filter bar, and paginated table driven by total + limit/offset.
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { can } = useAccess()
const hydrated = useHydrated()
const { shown: kpisShown } = useKpiVisibility()

const ALL = '__all__'
const PAGE_SIZE = APPOINTMENT_PAGE_SIZE

// The day lives in the URL, so refresh, back and a shared link all show the same day.
const day = computed(() => {
  const value = route.query.day
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : localIsoDay()
})
const state = computed<AppointmentBookingState | undefined>(() => {
  const value = route.query.state
  return value === 'pending' || value === 'scheduled' || value === 'confirmed' || value === 'canceled' ? value : undefined
})
const typeId = computed(() => {
  const value = Number(route.query.type_id)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
})
const offset = computed(() => parseOffset(route.query.offset))

const canRead = computed(() => hydrated.value && can('appointments.bookings.read'))
const types = useAppointmentTypes(canRead)
const bookings = useAppointmentBookings(() => ({
  from: day.value,
  to: day.value,
  ...(state.value ? { state: state.value } : {}),
  ...(typeId.value ? { type_id: typeId.value } : {}),
  limit: PAGE_SIZE,
  offset: offset.value,
}), canRead)

const kpis = useAppointmentListKpis(
  () => ({ day: day.value, type_id: typeId.value }),
  computed(() => canRead.value && kpisShown.value),
  { wholeDay: computed(() => !state.value), total: computed(() => bookings.data.value?.total) },
)

const items = computed(() => bookings.data.value?.items ?? [])
const total = computed(() => bookings.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const countTags = computed(() => bookings.data.value
  ? [{ label: t('appointments.list.countTag', { count: total.value }, total.value), kind: 'count' as const }]
  : [])

const activeFilterCount = computed(() => Number(Boolean(state.value)) + Number(Boolean(typeId.value)))

const typeItems = computed(() => [
  { value: ALL, label: t('appointments.list.allTypes') },
  ...(types.data.value?.items ?? []).map(type => ({ value: String(type.id), label: type.name })),
])
const stateItems = computed(() => [
  { value: ALL, label: t('appointments.list.allStates') },
  ...(['pending', 'scheduled', 'confirmed', 'canceled'] as const).map(value => ({ value, label: t(`appointments.state.${value}`) })),
])

const columns = computed<TableColumn<AppointmentBookingRow>[]>(() => [
  { accessorKey: 'requester_name', header: t('appointments.list.requester'), meta: { title: true, class: { th: 'min-w-64 w-[38%]', td: 'max-w-0' } } },
  { accessorKey: 'type_name', header: t('appointments.list.type'), meta: { class: { th: 'w-44', td: 'w-44 max-w-0' } } },
  { accessorKey: 'start', header: t('appointments.list.time'), meta: { class: { th: 'w-48', td: 'w-48 whitespace-nowrap' } } },
  { accessorKey: 'state', header: t('appointments.list.state'), meta: { class: { th: 'w-36', td: 'w-36 whitespace-nowrap' } } },
])

function writeQuery(patch: Record<string, string | null | undefined>, resetOffset = true) {
  void router.replace({ query: appointmentListQuery(route.query, patch, resetOffset) as Record<string, string | string[]> })
}

const step = (days: number) => {
  const date = new Date(`${day.value}T00:00:00`)
  date.setDate(date.getDate() + days)
  writeQuery({ day: localIsoDay(date) })
}

function clearFilters() {
  writeQuery({ state: undefined, type_id: undefined, offset: undefined })
}

function setPage(nextPage: number) {
  if (!hydrated.value || bookings.isFetching.value || nextPage < 1 || nextPage > pages.value) return
  const nextOffset = (nextPage - 1) * PAGE_SIZE
  writeQuery({ offset: nextOffset > 0 ? String(nextOffset) : undefined }, false)
}

// A day or filter that shrank can leave the URL on an offset past the last page, and the footer is drawn only with
// rows: move back to the last page that still has rows instead of showing an empty list.
watch([total, offset, () => bookings.data.value, () => bookings.isFetching.value], () => {
  if (!bookings.data.value || bookings.isFetching.value) return
  if (total.value === 0 || offset.value === 0 || items.value.length > 0) return
  const next = lastPageOffset(total.value, PAGE_SIZE)
  writeQuery({ offset: next > 0 ? String(next) : undefined }, false)
})

const listReturnTo = computed(() => kpiLink('/appointments', {
  day: typeof route.query.day === 'string' ? route.query.day : undefined,
  state: state.value,
  type_id: typeId.value,
  offset: offset.value || undefined,
}))

const createTo = computed(() => can('appointments.bookings.manage')
  ? { path: '/appointments/new', query: returnToQuery(listReturnTo.value) }
  : undefined)

const bookingTo = (id: number) => ({ path: `/appointments/${id}`, query: returnToQuery(listReturnTo.value) })
</script>

<template>
  <SharedListPage
    :title="t('appointments.title')"
    :tags="countTags"
    :create-to="createTo"
    :create-label="t('appointments.list.new')"
    create-test-id="appointments-new"
  >
    <template #kpis>
      <SharedKpiStrip
        v-if="hydrated"
        :tiles="kpis.tiles.value"
        :loading="kpis.loading.value"
        :label="t('appointments.kpi.label')"
        data-testid="appointments-kpi-strip"
      />
    </template>
    <SharedListCard>
      <template #filters>
        <SharedFilterBar
          embedded
          class="w-full"
          :active-count="activeFilterCount"
          :clear-label="t('appointments.list.clear')"
          :disabled="!hydrated"
          @clear="clearFilters"
        >
          <template #scope>
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              square
              icon="i-lucide-chevron-left"
              class="rtl:rotate-180"
              :aria-label="t('appointments.list.previousDay')"
              :disabled="!hydrated"
              data-testid="appointments-previous"
              @click="step(-1)"
            />
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              :label="t('appointments.list.today')"
              :disabled="!hydrated"
              data-testid="appointments-today"
              @click="writeQuery({ day: localIsoDay() })"
            />
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              square
              icon="i-lucide-chevron-right"
              class="rtl:rotate-180"
              :aria-label="t('appointments.list.nextDay')"
              :disabled="!hydrated"
              data-testid="appointments-next"
              @click="step(1)"
            />
          </template>
          <SharedDateField
            class="w-full md:w-40"
            :model-value="day"
            :disabled="!hydrated"
            :aria-label="t('appointments.list.day')"
            data-testid="appointments-day"
            @update:model-value="value => writeQuery({ day: value ?? undefined })"
          />
          <USelect
            :model-value="state ?? ALL"
            :items="stateItems"
            icon="i-lucide-activity"
            class="w-full md:w-44"
            :aria-label="t('appointments.list.state')"
            :disabled="!hydrated"
            data-testid="appointments-state"
            @update:model-value="value => writeQuery({ state: value === ALL ? undefined : String(value) })"
          />
          <USelect
            :model-value="typeId ? String(typeId) : ALL"
            :items="typeItems"
            icon="i-lucide-calendar-clock"
            class="w-full md:w-48"
            :aria-label="t('appointments.list.type')"
            :disabled="!hydrated"
            data-testid="appointments-type"
            @update:model-value="value => writeQuery({ type_id: value === ALL ? undefined : String(value) })"
          />
        </SharedFilterBar>
      </template>

      <SharedDataTable
        bare
        :rows="items"
        :columns="columns"
        row-key="id"
        :row-to="row => bookingTo(row.id)"
        :loading="bookings.isLoading.value"
        :error="bookings.error.value"
        :empty-text="t(activeFilterCount ? 'app.noResults' : 'appointments.list.empty')"
        :caption="t('appointments.title')"
        data-testid="appointments-table"
        @retry="bookings.refetch()"
      >
        <template #requester_name-cell="{ row }">
          <NuxtLink
            :to="bookingTo(row.original.id)"
            class="block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >{{ row.original.requester_name }}</NuxtLink>
          <div v-if="row.original.reference" class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <SharedRecordNumber :value="row.original.reference" />
          </div>
        </template>
        <template #type_name-cell="{ row }">
          <span class="block truncate text-muted">{{ row.original.type_name }}</span>
        </template>
        <template #start-cell="{ row }">
          <span class="tabular-nums">{{ row.original.start ? formatDateTime(row.original.start) : t('appointments.list.unscheduled') }}</span>
        </template>
        <template #state-cell="{ row }">
          <SharedStatusBadge :tone="appointmentStateTone(row.original.state)" :label="t(`appointments.state.${row.original.state}`)" />
        </template>
        <template #mobile-row="{ row }">
          <NuxtLink :to="bookingTo(row.id)" class="grid min-w-0 gap-2 focus-visible:outline-none">
            <div class="flex min-w-0 items-start justify-between gap-2">
              <span class="min-w-0 break-words font-semibold text-highlighted">{{ row.requester_name }}</span>
              <SharedStatusBadge :tone="appointmentStateTone(row.state)" :label="t(`appointments.state.${row.state}`)" class="shrink-0" />
            </div>
            <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <SharedRecordNumber v-if="row.reference" :value="row.reference" />
              <span class="truncate">{{ row.type_name }}</span>
              <span class="tabular-nums">{{ row.start ? formatDateTime(row.start) : t('appointments.list.unscheduled') }}</span>
            </div>
          </NuxtLink>
        </template>
      </SharedDataTable>

      <template v-if="!bookings.error.value && items.length" #footer>
        <SharedListFooter
          :count-label="t('appointments.list.footer', { shown: items.length, total }, total)"
          count-test-id="appointments-result-count"
          :page="page"
          :pages="pages"
          :disabled="bookings.isFetching.value || !hydrated"
          @update:page="setPage"
        />
      </template>
    </SharedListCard>
  </SharedListPage>
</template>
