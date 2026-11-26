<script setup lang="ts">
import { TelephonyCallDetailSchema } from '@liwan/contracts'

const { t } = useI18n()
const { $api } = useApi()
const route = useRoute()
const id = computed(() => Number(route.params.id))

const call = useQuery({
  queryKey: ['telephony', 'call', id],
  queryFn: () => $api(`/api/v1/telephony/calls/${id.value}`, { schema: TelephonyCallDetailSchema }),
})
const data = computed(() => call.data.value)

function duration(seconds: number | null) {
  if (!seconds) return '—'
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
</script>

<template>
  <SharedRecordPage
    :title="t('telephony.calls.detail')"
    hide-header="false"
    :back-to="'/calls'"
    :back-label="t('telephony.nav.calls')"
  >
    <SharedPageState
      :loading="call.isPending.value"
      :error="call.error.value"
      :empty="!data"
      :empty-text="t('telephony.calls.empty')"
      @retry="call.refetch()"
    >
      <template v-if="data">
        <SharedRecordSection variant="panel" :title="t('telephony.column.number')">
          <dl class="grid gap-(--liwan-gap-card)">
            <div class="flex justify-between">
              <dt class="text-muted">{{ t('telephony.direction.in') === data.direction ? t('telephony.direction.in') : t(`telephony.direction.${data.direction}`) }}</dt>
              <dd dir="ltr">{{ data.remoteNumber || '—' }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-muted">{{ t('telephony.column.state') }}</dt>
              <dd>{{ t(`telephony.state.${data.state}`) }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-muted">{{ t('telephony.column.duration') }}</dt>
              <dd dir="ltr">{{ duration(data.durationSeconds) }}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-muted">{{ t('telephony.calls.recording') }}</dt>
              <dd>
                <span v-if="!data.canListen">{{ t('telephony.calls.canNotListen') }}</span>
                <span v-else-if="data.recordingState !== 'available'">{{ t('telephony.calls.noRecording') }}</span>
                <span v-else>{{ t('telephony.calls.recording') }}</span>
              </dd>
            </div>
          </dl>
        </SharedRecordSection>
      </template>
    </SharedPageState>
  </SharedRecordPage>
</template>
