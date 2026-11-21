<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useLookupNumber } from '@/composables/useIntegrationCommunications'
import { integrationErrorText, integrationServerMessage } from '@/utils/integrationLabels'
import type { IntegrationLookupResult } from '@liwan/contracts'

// The lookup test: check one number with the provider and show what it answers — validity, the E.164 form, the
// country and, when asked, the line type. The line-type question is billed per request on the company's own Twilio
// balance, so the switch says so. Nothing about the number is stored. The test route needs integrations.manage.
const props = defineProps<{ canManage: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const idBase = useId()

const lookup = useLookupNumber()
const number = ref('')
const lineType = ref(false)
const fieldErrors = ref<Record<string, string>>({})
const failure = ref('')
const result = ref<IntegrationLookupResult | null>(null)
const busy = computed(() => !hydrated.value || !props.canManage || lookup.isPending.value)

const focusField = async (name: string) => { await nextTick(); document.getElementById(`${idBase}-${name}`)?.focus() }

async function submit() {
  if (busy.value) return
  failure.value = ''
  fieldErrors.value = {}
  result.value = null
  const value = number.value.trim()
  if (!value) {
    fieldErrors.value = { number: t('integrations.communications.lookup.required') }
    return focusField('number')
  }
  try {
    result.value = await lookup.mutateAsync({ number: value, ...(lineType.value ? { line_type: true } : {}) })
  } catch (error) {
    const field = error instanceof ApiError ? error.field : undefined
    if (field === 'number') fieldErrors.value = { number: integrationServerMessage(error) || integrationErrorText(error, t) }
    else failure.value = integrationErrorText(error, t)
  }
}
</script>

<template>
  <SharedRecordSection id="lookup" variant="panel" class="liwan-settings-anchor" :title="t('integrations.communications.lookup.title')" :description="t('integrations.communications.lookup.hint')" data-testid="communication-lookup">
    <SharedForbiddenState v-if="!canManage" :description="t('integrations.errors.forbidden')" />
    <UForm v-else :state="{ number, lineType }" class="grid gap-4 text-start" novalidate :loading-auto="false" @submit="submit">
      <UFormField :label="t('integrations.communications.lookup.number')" :description="t('integrations.communications.lookup.numberHint')" name="number" required :error="fieldErrors.number">
        <UInput :id="`${idBase}-number`" v-model="number" type="tel" dir="ltr" autocomplete="off" class="w-full sm:max-w-64" :disabled="busy" data-testid="communication-lookup-number" />
      </UFormField>
      <USwitch v-model="lineType" :label="t('integrations.communications.lookup.lineType')" :description="t('integrations.communications.lookup.lineTypeHint')" :disabled="busy" data-testid="communication-lookup-line-type" />
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="failure" data-testid="communication-lookup-error" />
      <div class="flex justify-end">
        <UButton type="submit" color="primary" icon="i-lucide-search-check" :disabled="busy" :loading="lookup.isPending.value" :label="t('integrations.communications.lookup.check')" data-testid="communication-lookup-check" />
      </div>
      <div v-if="result" class="grid gap-3 rounded-card border border-default p-(--liwan-card-pad-dense)" aria-live="polite" data-testid="communication-lookup-result">
        <div class="flex flex-wrap items-center gap-2">
          <SharedStatusBadge :tone="result.valid ? 'success' : 'destructive'" :label="t(result.valid ? 'integrations.communications.lookup.valid' : 'integrations.communications.lookup.notValid')" data-testid="communication-lookup-valid" />
        </div>
        <dl class="grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-6">
          <dt class="text-muted">{{ t('integrations.communications.lookup.e164') }}</dt>
          <dd><bdi v-if="result.e164" dir="ltr">{{ result.e164 }}</bdi><template v-else>—</template></dd>
          <dt class="text-muted">{{ t('integrations.communications.lookup.country') }}</dt>
          <dd><bdi v-if="result.country" dir="ltr">{{ result.country }}</bdi><template v-else>—</template></dd>
          <dt class="text-muted">{{ t('integrations.communications.lookup.lineTypeResult') }}</dt>
          <dd><bdi v-if="result.line_type" dir="ltr">{{ result.line_type }}</bdi><template v-else>—</template></dd>
        </dl>
      </div>
    </UForm>
  </SharedRecordSection>
</template>
