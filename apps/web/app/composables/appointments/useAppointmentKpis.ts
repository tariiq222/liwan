import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { appointmentKpiFilters, appointmentKpiLinks, appointmentListTiles, type AppointmentKpiScope } from '../../utils/appointmentKpis'
import { useAppointmentBookings } from './useAppointments'

/**
 * The list's own total: while the list carries no state filter it counts the whole day, so the total tile reads it
 * instead of asking a second `limit: 1` query. `wholeDay` turns false as soon as a state filter narrows the list.
 */
export interface AppointmentKpiListTotal {
  wholeDay: MaybeRefOrGetter<boolean>
  total: MaybeRefOrGetter<number | undefined>
}

/**
 * The four KPI tiles of /appointments, counted from `/api/v1/appointments/bookings` totals with `limit: 1` — except
 * the day total, which the list itself supplies while it carries no state filter.
 * Every query stays disabled while KPIs are hidden (`useKpiVisibility`), before hydration, or without read rights.
 */
export function useAppointmentListKpis(
  scope: MaybeRefOrGetter<AppointmentKpiScope>,
  enabled: MaybeRefOrGetter<boolean> = true,
  listTotal?: AppointmentKpiListTotal,
) {
  const { t } = useI18n()
  const filters = computed(() => appointmentKpiFilters(toValue(scope)))
  const totalFromList = computed(() => listTotal !== undefined && toValue(listTotal.wholeDay))
  const listTotalValue = computed(() => (totalFromList.value && listTotal ? toValue(listTotal.total) : undefined))
  const queries = {
    total: useAppointmentBookings(() => filters.value.total, computed(() => toValue(enabled) && !totalFromList.value)),
    scheduled: useAppointmentBookings(() => filters.value.scheduled, enabled),
    confirmed: useAppointmentBookings(() => filters.value.confirmed, enabled),
    canceled: useAppointmentBookings(() => filters.value.canceled, enabled),
  }
  const links = computed(() => appointmentKpiLinks(toValue(scope)))
  const tiles = computed(() => appointmentListTiles({
    total: totalFromList.value ? listTotalValue.value : queries.total.data.value?.total,
    scheduled: queries.scheduled.data.value?.total,
    confirmed: queries.confirmed.data.value?.total,
    canceled: queries.canceled.data.value?.total,
  }, links.value, t))
  const loading = computed(() => Object.values(queries).some(query => query.isLoading.value))
  return { tiles, loading }
}
