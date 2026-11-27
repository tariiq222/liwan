<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import type { TelephonyCallDetail } from '@liwan/contracts'
import { TelephonyCallDetailSchema } from '@liwan/contracts'

/**
 * The call's own page (design section 8): who called whom, when, for how long, and the recording when the reader may
 * listen to it. The link the server hands out lives one minute, so it is asked for on a click rather than on load.
 */
const { t } = useI18n()
const { $api } = useApi()
const route = useRoute()
const id = computed(() => Number(route.params.id))

const call = useQuery({
  queryKey: ['telephony', 'call', id],
  queryFn: () => $api(`/api/v1/telephony/calls/${id.value}`, { schema: TelephonyCallDetailSchema }),
})
const data = computed(() => call.data.value)
const player = ref<string | null>(null)
const busy = ref(false)
const failed = ref<string | null>(null)

async function listen() {
  busy.value = true
  failed.value = null
  try {
    const link = await $api<{ url: string }>(`/api/v1/telephony/calls/${id.value}/recording`, { method: 'GET' })
    player.value = link.url
  }
  catch (error) {
    failed.value = error instanceof Error ? error.message : t('telephony.calls.noRecording')
  }
  finally {
    busy.value = false
  }
}

function duration(seconds: number | null) {
  if (!seconds) return '—'
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
</script>

<template>
  <SharedRecordPage :title="t('telephony.calls.detail')" :back-to="'/calls'" :back-label="t('telephony.nav.calls')">
    <SharedPageState
      :loading="call.isPending.value"
      :error="call.error.value"
      :empty="!data"
      :empty-text="t('telephony.calls.empty')"
      @retry="call.refetch"
    >
      <template v-if="data">
        <SharedRecordSection variant="panel" :title="t('telephony.calls.detail')">
          <dl class="grid gap-(--liwan-gap-card)">
            <div class="flex justify-between gap-4">
              <dt class="text-muted">{{ t('telephony.column.direction') }}</dt>
              <dd>{{ t(`telephony.direction.${data.direction}`) }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted">{{ t('telephony.column.number') }}</dt>
              <dd dir="ltr">{{ data.remoteNumber || '—' }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted">{{ t('telephony.column.state') }}</dt>
              <dd>{{ t(`telephony.state.${data.state}`) }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted">{{ t('telephony.column.duration') }}</dt>
              <dd dir="ltr">{{ duration(data.durationSeconds) }}</dd>
            </div>
          </dl>
        </SharedRecordSection>

        <SharedRecordSection variant="panel" :title="t('telephony.calls.recording')">
          <p v-if="!data.canListen" class="text-sm text-muted">
            {{ t('telephony.calls.canNotListen') }}
          </p>
          <p v-else-if="data.recordingState !== 'available'" class="text-sm text-muted">
            {{ t('telephony.calls.noRecording') }}
          </p>
          <div v-else class="grid gap-3">
            <UButton v-if="!player" :loading="busy" icon="i-lucide-play" @click="listen">
              {{ t('telephony.calls.listen') }}
            </UButton>
            <audio v-if="player" :src="player" controls class="w-full" />
            <p v-if="failed" class="text-sm text-error">{{ failed }}</p>
          </div>
        </SharedRecordSection>
      </template>
    </SharedPageState>
  </SharedRecordPage>
</template>
