<script setup lang="ts">
/**
 * The call chip in the header, beside the bell (design D3 and section 8).
 *
 * It is not a floating panel over the content: a short chip that stays in the header while the employee moves between
 * pages. Idle it shows only the register state; ringing it colours and offers answer and reject; in a call it shows the
 * caller and the duration with a hang-up. Clicking opens the caller card and the in-call controls.
 *
 * The softphone itself (JsSIP, the WebSocket, the microphone) arrives in the next part; this component owns the
 * presentation and the state it is given, so the phone can be wired to it without touching the shell again.
 */
const seam = useCallChip()

/**
 * The labels arrive from the application: the shared layer owns no application key. `visible` is false for a user who
 * may not use the phone, so the shell shows nothing rather than a disabled control.
 */
const labels = computed(() => seam?.labels)

const durationText = computed(() => {
  const minutes = Math.floor(seconds.value / 60)
  return `${minutes}:${String(seconds.value % 60).padStart(2, '0')}`
})

const tone = computed(() => {
  if (phase.value === 'ringing') return 'warning'
  if (phase.value === 'in-call' || phase.value === 'calling') return 'success'
  if (phase.value === 'failed') return 'danger'
  return 'neutral'
})

let timer: ReturnType<typeof setInterval> | null = null

function startTimer() {
  stopTimer()
  timer = setInterval(() => { seconds.value += 1 }, 1000)
}

function stopTimer() {
  if (timer) clearInterval(timer)
  timer = null
}

function hangUp() {
  stopTimer()
  seconds.value = 0
  open.value = false
  seam?.actions.hangUp()
}

// The duration comes from the phone's own start time when it has one, so a page change does not restart the clock.
watch(() => [raw.value, seam?.state.value.since] as const, ([now, startedAt]) => {
  if (now === 'in-call' && startedAt) {
    seconds.value = Math.max(Math.floor((Date.now() - startedAt) / 1000), 0)
    startTimer()
  }
  else if (now !== 'in-call') {
    stopTimer()
  }
}, { immediate: true })

onBeforeUnmount(stopTimer)
</script>

<template>
  <div v-if="seam" class="liwan-call-chip" role="group" :aria-label="labels?.label">
    <UPopover v-model:open="open" :disabled="phase === 'idle'" :content="{ align: 'end' }">
      <UButton
        :color="tone === 'danger' ? 'error' : tone === 'warning' ? 'warning' : tone === 'success' ? 'success' : 'neutral'"
        :variant="phase === 'idle' ? 'ghost' : 'solid'"
        size="sm"
        icon="i-lucide-phone"
        :aria-label="label"
        :disabled="!hydrated"
        :data-phase="phase"
        data-testid="telephony-call-chip"
      >
        <span class="tabular-nums" dir="ltr">{{ label }}</span>
      </UButton>
      <template #content>
        <div class="grid w-64 gap-(--liwan-gap-card) p-(--liwan-card-pad)">
          <p class="text-sm font-semibold">{{ labels?.callerCard }}</p>
          <p class="text-sm" dir="ltr">{{ caller || '—' }}</p>
          <p v-if="phase === 'in-call'" class="text-sm tabular-nums" dir="ltr">{{ durationText }}</p>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="phase === 'ringing'"
              size="sm"
              icon="i-lucide-phone-incoming"
              @click="seam?.actions.answer()"
            >
              {{ labels?.answer }}
            </UButton>
            <UButton
              v-if="phase === 'ringing'"
              size="sm"
              color="error"
              variant="outline"
              icon="i-lucide-phone-off"
              @click="hangUp"
            >
              {{ labels?.reject }}
            </UButton>
            <UButton
              v-if="phase === 'in-call' || phase === 'calling'"
              size="sm"
              color="error"
              icon="i-lucide-phone-off"
              @click="hangUp"
            >
              {{ labels?.hangUp }}
            </UButton>
          </div>
          <p v-if="phase === 'failed'" class="text-sm text-muted">{{ labels?.failedHint }}</p>
        </div>
      </template>
    </UPopover>
  </div>
</template>
