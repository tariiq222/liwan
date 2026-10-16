import { type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  MaintenanceSnapshotSchema, MaintenancePreferenceSchema, MaintenanceBookingSchema,
  type MaintenancePreferencePatch, type MaintenanceBookingInput, type MaintenanceBookingPatch,
} from '@webvue/contracts'

const maintenanceKey = ['admin-maintenance'] as const
export function useMaintenance(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({ queryKey: maintenanceKey, enabled, queryFn: () => $api('/api/v1/admin/maintenance', { schema: MaintenanceSnapshotSchema }), retry: false })
}
export function useMaintenanceActions() {
  const { $api } = useApi()
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: maintenanceKey })
  const preference = useMutation({
    mutationFn: (value: MaintenancePreferencePatch) => $api('/api/v1/admin/maintenance/preference', { method: 'PATCH', body: value, schema: MaintenancePreferenceSchema }),
    onSuccess: refresh,
  })
  const booking = useMutation({
    mutationFn: (value: MaintenanceBookingInput) => $api('/api/v1/admin/maintenance/bookings', { method: 'POST', body: value, schema: MaintenanceBookingSchema }),
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, value }: { id: number; value: MaintenanceBookingPatch }) => $api(`/api/v1/admin/maintenance/bookings/${id}`, { method: 'PATCH', body: value, schema: MaintenanceBookingSchema }),
    onSuccess: refresh,
  })
  return { preference, booking, update }
}
