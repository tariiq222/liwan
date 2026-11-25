import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { appointmentKpiFilters, appointmentKpiLinks, appointmentListTiles, type AppointmentKpiScope } from '@/utils/appointmentKpis'
import { useAppointmentBookings } from './useAppointments'

/**
 * The four KPI tiles of /appointments, counted from `/api/v1/appointments/bookings` totals with `limit: 1`.
 * Every query stays disabled while KPIs are hidden (`useKpiVisibility`), before hydration, or without read rights.
 */
export function useAppointmentListKpis(
  scope: MaybeRefOrGetter<AppointmentKpiScope>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const { t } = useI18n()
  const filters = computed(() => appointmentKpiFilters(toValue(scope)))
  const queries = {
    total: useAppointmentBookings(() => filters.value.total, enabled),
    scheduled: useAppointmentBookings(() => filters.value.scheduled, enabled),
    confirmed: useAppointmentBookings(() => filters.value.confirmed, enabled),
    canceled: useAppointmentBookings(() => filters.value.canceled, enabled),
  }
  const links = computed(() => appointmentKpiLinks(toValue(scope)))
  const tiles = computed(() => appointmentListTiles({
    total: queries.total.data.value?.total,
    scheduled: queries.scheduled.data.value?.total,
    confirmed: queries.confirmed.data.value?.total,
    canceled: queries.canceled.data.value?.total,
  }, links.value, t))
  const loading = computed(() => Object.values(queries).some(query => query.isLoading.value))
  return { tiles, loading }
}
