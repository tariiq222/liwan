<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { TelephonyCallDetailSchema, TelephonyRecordingLinkSchema } from '@liwan/contracts'
import { callDuration, callNumber, callParty, callTime } from '@/components/telephony/callPresentation'
import { ApiError } from '@/composables/useApi'
import { owningListBack } from '@/utils/recordListOrigin'

/**
 * One call of the log: who it was with (the title), the employee who took it, when it started, was answered and ended,
 * and its recording for a reader who may listen. The back link and Escape return to the list the reader came from, with
 * its filters and page; opened directly, they return to the whole log. The recording link lives one minute, so it is
 * asked for on a click rather than on load.
 */
const { t } = useI18n()
const { $api } = useApi()
const route = useRoute()
const { me } = useMe()
const sourcePaths = useRecordListPaths(['/calls'])
const id = computed(() => Number(route.params.id))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)

const call = useQuery({
  queryKey: ['telephony', 'call', id],
  enabled: validId,
  queryFn: () => $api(`/api/v1/telephony/calls/${id.value}`, { schema: TelephonyCallDetailSchema }),
})
const data = computed(() => call.data.value)
// An id that is not a positive integer has no record to load: it shows the same not-found state as an unknown one.
const pageError = computed(() => call.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const timeZone = computed(() => me.value?.tz)
const tags = computed(() => data.value
  ? [
      { label: t(`telephony.direction.${data.value.direction}`) },
      { label: t(`telephony.state.${data.value.state}`) },
    ]
  : [])

const player = ref<string | null>(null)
const busy = ref(false)
const failed = ref<string | null>(null)

async function listen() {
  busy.value = true
  failed.value = null
  try {
    const link = await $api(`/api/v1/telephony/calls/${id.value}/recording`, {
      method: 'GET',
      schema: TelephonyRecordingLinkSchema,
    })
    player.value = link.url
  }
  catch (error) {
    failed.value = error instanceof Error ? error.message : t('telephony.calls.noRecording')
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <SharedRecordPage
    :title="data ? callParty(data) : ''"
    :tags="tags"
    :back-to="backTo"
    :back-label="t('telephony.nav.calls')"
    :loading="call.isLoading.value"
    :error="pageError"
    :keep-content="!!data"
    aside-first
    @retry="call.refetch"
  >
    <template v-if="data" #aside>
      <SharedPropertiesPanel :title="t('telephony.calls.detail')">
        <SharedPropertyRow :label="t('telephony.calls.started')" :value="callTime(data.startedAt, timeZone)" />
        <SharedPropertyRow :label="t('telephony.calls.answered')" :value="callTime(data.answeredAt, timeZone)" />
        <SharedPropertyRow :label="t('telephony.calls.ended')" :value="callTime(data.endedAt, timeZone)" />
        <SharedPropertyRow :label="t('telephony.column.duration')" :value="callDuration(data.durationSeconds)" />
        <SharedPropertyRow :label="t('telephony.column.user')" :value="data.user?.name" />
        <SharedPropertyRow v-if="data.partner && callNumber(data)" :label="t('telephony.column.number')">
          <bdi dir="ltr">{{ callNumber(data) }}</bdi>
        </SharedPropertyRow>
      </SharedPropertiesPanel>
    </template>

    <SharedRecordSection v-if="data" variant="panel" :title="t('telephony.calls.recording')">
      <p v-if="!data.canListen" class="text-sm text-muted">
        {{ t('telephony.calls.canNotListen') }}
      </p>
      <p v-else-if="data.recordingState !== 'available'" class="text-sm text-muted">
        {{ t('telephony.calls.noRecording') }}
      </p>
      <div v-else class="grid gap-(--liwan-gap-card)">
        <UButton v-if="!player" :loading="busy" icon="i-lucide-play" @click="listen">
          {{ t('telephony.calls.listen') }}
        </UButton>
        <audio v-if="player" :src="player" controls class="w-full" />
        <p v-if="failed" class="text-sm text-error">{{ failed }}</p>
      </div>
    </SharedRecordSection>
  </SharedRecordPage>
</template>
