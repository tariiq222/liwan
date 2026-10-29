<script setup lang="ts">
import { addDays, BOOK_WINDOW_DAYS, formatDay, formatSlot, refusalStatus, slotsByDay, windowDays, type BookingLink } from '@/composables/appointmentBook'
import { useGuestSlots } from '@/composables/useAppointmentBooking'

// The requester's choice of a time: a week of days at a time, and the free slots of the chosen day as radio choices. The
// weeks are days of the booking type's calendar (its today to the last day the company takes bookings), which is how the
// server reads a slots request; the slots themselves are UTC, shown as days and times of the requester's own.
const props = defineProps<{ link: BookingLink; firstDate: string; lastDate: string; submitLabel: string; pending: boolean }>()
const emit = defineEmits<{ submit: [start: string] }>()

const { t, locale } = useI18n()
const hydrated = useHydrated()

const windowStart = ref(props.firstDate)
// A refused call re-reads the booking, whose bookable days may have moved (a shorter horizon, a new day): a week that
// falls outside them starts again from the first.
watch(() => [props.firstDate, props.lastDate], () => {
  if (windowStart.value < props.firstDate || windowStart.value > props.lastDate) windowStart.value = props.firstDate
})
const days = computed(() => windowDays(windowStart.value, props.lastDate))
const range = computed(() => (days.value.length ? { from: days.value[0]!, to: days.value.at(-1)! } : null))
const hasPrevious = computed(() => windowStart.value > props.firstDate)
const hasNext = computed(() => addDays(windowStart.value, BOOK_WINDOW_DAYS) <= props.lastDate)

const slots = useGuestSlots(computed(() => props.link), range)
const byDay = computed(() => slotsByDay(slots.data.value?.items ?? []))
// A slot can fall on a neighbouring day of the requester's own calendar (their time zone is not the company's): its day is listed too.
const dayChoices = computed(() => [...new Set([...days.value, ...byDay.value.keys()])].sort())
const chosenDay = ref<string>()
// The day shown is the chosen one while it still has free slots, otherwise the first that has.
const shownDay = computed(() => (chosenDay.value && byDay.value.has(chosenDay.value) ? chosenDay.value : byDay.value.keys().next().value))
const daySlots = computed(() => (shownDay.value ? byDay.value.get(shownDay.value) ?? [] : []))
const slotItems = computed(() => daySlots.value.map(slot => ({ value: slot.start, label: formatSlot(slot, locale.value) })))
const chosenStart = ref<string>()
const picked = computed(() => daySlots.value.find(slot => slot.start === chosenStart.value))

// A new window or a taken slot leaves no choice behind that the list no longer holds.
watch(daySlots, () => { if (!picked.value) chosenStart.value = undefined })

function move(direction: 1 | -1) {
  windowStart.value = addDays(windowStart.value, direction * BOOK_WINDOW_DAYS)
  chosenDay.value = undefined
}
</script>

<template>
  <section class="grid gap-3" :aria-label="t('appointments.book.picker.title')" data-testid="book-picker">
    <h2 class="text-base font-semibold text-highlighted">{{ t('appointments.book.picker.title') }}</h2>
    <div class="flex items-center justify-between gap-2">
      <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-chevron-left" class="rtl:rotate-180" :aria-label="t('appointments.book.picker.previous')" :disabled="!hydrated || !hasPrevious" data-testid="book-window-previous" @click="move(-1)" />
      <p v-if="range" class="text-center text-sm text-muted" data-testid="book-window">{{ formatDay(range.from, locale, 'short') }} – {{ formatDay(range.to, locale, 'short') }}</p>
      <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-chevron-right" class="rtl:rotate-180" :aria-label="t('appointments.book.picker.next')" :disabled="!hydrated || !hasNext" data-testid="book-window-next" @click="move(1)" />
    </div>
    <SharedLoadingSkeleton v-if="slots.isPending.value" />
    <div v-else-if="slots.isError.value" class="grid gap-3">
      <UAlert role="alert" color="warning" variant="subtle" icon="i-lucide-cloud-off" :title="t(refusalStatus(slots.error.value) === 429 ? 'appointments.book.states.busy.title' : 'appointments.book.picker.failed')" data-testid="book-slots-error" />
      <UButton type="button" color="neutral" variant="outline" class="w-full justify-center" icon="i-lucide-refresh-cw" :label="t('appointments.book.retry')" @click="() => slots.refetch()" />
    </div>
    <UAlert v-else-if="!byDay.size" role="status" color="neutral" variant="subtle" icon="i-lucide-calendar-x" :title="t('appointments.book.picker.empty')" data-testid="book-slots-empty" />
    <template v-else>
      <div role="group" :aria-label="t('appointments.book.picker.day')" class="flex flex-wrap gap-2">
        <UButton
          v-for="day in dayChoices"
          :key="day"
          type="button"
          size="sm"
          :color="day === shownDay ? 'primary' : 'neutral'"
          :variant="day === shownDay ? 'solid' : 'outline'"
          :aria-pressed="day === shownDay"
          :aria-label="formatDay(day, locale)"
          :disabled="!hydrated || !byDay.has(day)"
          :label="formatDay(day, locale, 'short')"
          data-testid="book-day"
          @click="chosenDay = day"
        />
      </div>
      <URadioGroup
        v-model="chosenStart"
        :items="slotItems"
        :legend="t('appointments.book.picker.time')"
        variant="card"
        :ui="{ fieldset: 'grid grid-cols-2 gap-2' }"
        :disabled="!hydrated || props.pending"
        data-testid="book-slots"
      />
    </template>
    <UButton type="button" size="lg" class="w-full justify-center" icon="i-lucide-calendar-check" :loading="props.pending" :disabled="!hydrated || !picked" :label="props.submitLabel" data-testid="book-submit" @click="picked && emit('submit', picked.start)" />
  </section>
</template>
