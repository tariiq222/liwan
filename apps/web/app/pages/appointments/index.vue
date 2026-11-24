<script setup lang="ts">
import { formatDateTime, localIsoDay } from '@liwan/ui/app/utils/formatDate'
import SharedDateField from '@liwan/ui/app/components/shared/form/DateField.vue'
import { useAppointmentBookings, useAppointmentTypes } from '@/composables/appointments/useAppointments'
import type { AppointmentBookingState } from '@liwan/contracts'

// The staff bookings list: the appointments of the chosen day, grouped by state, with the actions the server allows.
// It reads `/api/v1/appointments/bookings` and nothing else; a booking's own page carries its actions.
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { can } = useAccess()
const hydrated = useHydrated()

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

const types = useAppointmentTypes(computed(() => hydrated.value && can('appointments.bookings.read')))
const bookings = useAppointmentBookings(() => ({
  from: day.value,
  to: day.value,
  ...(state.value ? { state: state.value } : {}),
  ...(typeId.value ? { type_id: typeId.value } : {}),
  limit: 200,
}), computed(() => hydrated.value && can('appointments.bookings.read')))

const items = computed(() => bookings.data.value?.items ?? [])
const typeItems = computed(() => [
  { value: '', label: t('appointments.list.allTypes') },
  ...(types.data.value?.items ?? []).map(type => ({ value: String(type.id), label: type.name })),
])
const stateItems = computed(() => [
  { value: '', label: t('appointments.list.allStates') },
  ...(['pending', 'scheduled', 'confirmed', 'canceled'] as const).map(value => ({ value, label: t(`appointments.state.${value}`) })),
])

function writeQuery(patch: Record<string, string | null | undefined>) {
  const next = { ...route.query, ...patch }
  for (const [key, value] of Object.entries(patch)) if (!value) delete next[key]
  void router.replace({ query: next })
}
const step = (days: number) => {
  const date = new Date(`${day.value}T00:00:00`)
  date.setDate(date.getDate() + days)
  writeQuery({ day: localIsoDay(date) })
}
const bookingTo = (id: number) => ({ path: `/appointments/${id}`, query: { returnTo: route.fullPath } })
</script>

<template>
  <SharedListPage
    :title="t('appointments.title')"
    :create-to="can('appointments.bookings.manage') ? { path: '/appointments/new', query: { returnTo: route.fullPath } } : undefined"
    :create-label="t('appointments.list.new')"
    create-test-id="appointments-new"
  >
    <SharedListCard>
      <template #filters>
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="outline" square icon="i-lucide-chevron-right" :aria-label="t('appointments.list.previousDay')" :disabled="!hydrated" data-testid="appointments-previous" @click="step(-1)" />
          <SharedDateField :model-value="day" :disabled="!hydrated" :aria-label="t('appointments.list.day')" data-testid="appointments-day" @update:model-value="value => writeQuery({ day: value })" />
          <UButton type="button" color="neutral" variant="outline" square icon="i-lucide-chevron-left" :aria-label="t('appointments.list.nextDay')" :disabled="!hydrated" data-testid="appointments-next" @click="step(1)" />
          <UButton type="button" color="neutral" variant="ghost" :label="t('appointments.list.today')" :disabled="!hydrated" data-testid="appointments-today" @click="writeQuery({ day: localIsoDay() })" />
          <USelect :model-value="state ?? ''" :items="stateItems" class="w-full md:w-40" :aria-label="t('appointments.list.state')" :disabled="!hydrated" data-testid="appointments-state" @update:model-value="value => writeQuery({ state: String(value) || undefined })" />
          <USelect :model-value="typeId ? String(typeId) : ''" :items="typeItems" class="w-full md:w-44" :aria-label="t('appointments.list.type')" :disabled="!hydrated" data-testid="appointments-type" @update:model-value="value => writeQuery({ type_id: String(value) || undefined })" />
        </div>
      </template>
      <SharedPageState
        :loading="bookings.isLoading.value"
        :error="bookings.error.value"
        :keep-content="items.length > 0"
        :empty="!items.length"
        :empty-text="t('appointments.list.empty')"
        @retry="bookings.refetch()"
      >
        <SharedDataTable
          bare
          :rows="items"
          row-key="id"
          :row-to="row => bookingTo(row.id)"
          :caption="t('appointments.title')"
          :columns="[
            { accessorKey: 'requester_name', header: t('appointments.list.requester'), meta: { class: { th: 'min-w-56', td: 'max-w-0' } } },
            { accessorKey: 'start', header: t('appointments.list.time'), meta: { class: { th: 'w-48', td: 'w-48 whitespace-nowrap' } } },
            { accessorKey: 'state', header: t('appointments.list.state'), meta: { class: { th: 'w-36', td: 'w-36 whitespace-nowrap' } } },
          ]"
          data-testid="appointments-table"
        >
          <template #requester_name-cell="{ row }">
            <NuxtLink :to="bookingTo(row.original.id)" class="block truncate font-semibold text-highlighted hover:underline">{{ row.original.requester_name }}</NuxtLink>
          </template>
          <template #start-cell="{ row }">
            <span class="tabular-nums">{{ row.original.start ? formatDateTime(row.original.start) : t('appointments.list.unscheduled') }}</span>
          </template>
          <template #state-cell="{ row }">
            <SharedStatusBadge :tone="row.original.state === 'confirmed' ? 'success' : row.original.state === 'canceled' ? 'neutral' : 'info'" :label="t(`appointments.state.${row.original.state}`)" />
          </template>
        </SharedDataTable>
      </SharedPageState>
    </SharedListCard>
  </SharedListPage>
</template>
