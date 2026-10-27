<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { HrBankProfile } from '@webvue/contracts'

// The salary files of a fixed run: the bank transfer file (with its value date) and the WPS file, each laid out by a
// profile the company chose, and the link to the GOSI statement. The page sends the request and shows a refusal (missing IBAN, WPS totals) above; here a
// download stays pending until the server answers. Not printed.
type Kind = 'bank' | 'wps'
const props = defineProps<{
  profiles: HrBankProfile[]
  /** False while the profiles are loading or refused: the empty-list note then stays hidden. */
  profilesReady: boolean
  /** The file being downloaded, or null. */
  pending: Kind | null
  /** False while the tenant is read-only (`hr.payroll` not writable): the files are kept server-side, so they are not offered. */
  writable: boolean
  /** The value date the bank file starts with (`YYYY-MM-DD`). */
  defaultDate: string
  /** The GOSI statement page of the run. */
  gosiTo: RouteLocationRaw
}>()
const emit = defineEmits<{ download: [file: { kind: Kind; profileId: number; valueDate?: string }] }>()

const { t } = useI18n()
const hydrated = useHydrated()

const chosen = reactive<Record<Kind, string | undefined>>({ bank: undefined, wps: undefined })
const valueDate = ref<string | null>(props.defaultDate)

const items = (kind: Kind) => props.profiles.filter(profile => profile.kind === kind).map(profile => ({ value: String(profile.id), label: profile.name }))
const profileId = (kind: Kind) => chosen[kind] ?? items(kind)[0]?.value
const canDownload = (kind: Kind) => props.writable && hydrated.value && props.pending === null && profileId(kind) !== undefined && (kind === 'wps' || !!valueDate.value)

function download(kind: Kind) {
  const id = profileId(kind)
  if (!canDownload(kind) || id === undefined) return
  emit('download', kind === 'bank' ? { kind, profileId: Number(id), valueDate: valueDate.value ?? undefined } : { kind, profileId: Number(id) })
}
</script>

<template>
  <SharedFormSection class="webvue-print-hide" panel :title="t('hrPayroll.files.title')" :description="t('hrPayroll.files.hint')" data-testid="hr-payroll-files">
    <div class="webvue-form-grid">
      <UFormField :label="t('hrPayroll.files.bankProfile')" name="hr-payroll-file-bank-profile">
        <USelect id="hr-payroll-file-bank-profile" class="w-full" :items="items('bank')" :model-value="profileId('bank')" @update:model-value="chosen.bank = String($event)" :disabled="!hydrated || props.pending !== null" data-testid="hr-payroll-file-bank-profile" />
      </UFormField>
      <UFormField :label="t('hrPayroll.files.valueDate')" name="hr-payroll-file-value-date">
        <SharedDateField id="hr-payroll-file-value-date" v-model="valueDate" :disabled="!hydrated || props.pending !== null" :aria-label="t('hrPayroll.files.valueDate')" data-testid="hr-payroll-file-value-date" />
      </UFormField>
      <UFormField :label="t('hrPayroll.files.wpsProfile')" name="hr-payroll-file-wps-profile">
        <USelect id="hr-payroll-file-wps-profile" class="w-full" :items="items('wps')" :model-value="profileId('wps')" @update:model-value="chosen.wps = String($event)" :disabled="!hydrated || props.pending !== null" data-testid="hr-payroll-file-wps-profile" />
      </UFormField>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <UButton color="primary" variant="outline" icon="i-lucide-landmark" :disabled="!canDownload('bank')" :loading="props.pending === 'bank'" :label="t('hrPayroll.files.downloadBank')" data-testid="hr-payroll-download-bank" @click="download('bank')" />
      <UButton color="primary" variant="outline" icon="i-lucide-file-spreadsheet" :disabled="!canDownload('wps')" :loading="props.pending === 'wps'" :label="t('hrPayroll.files.downloadWps')" data-testid="hr-payroll-download-wps" @click="download('wps')" />
      <UButton color="neutral" variant="outline" icon="i-lucide-shield-check" :to="props.gosiTo" :label="t('hrPayroll.gosiStatement.open')" data-testid="hr-payroll-open-gosi" />
    </div>
    <p v-if="!props.writable" class="text-sm text-muted" data-testid="hr-payroll-files-read-only">{{ t('hrPayroll.files.readOnly') }}</p>
    <p v-if="props.profilesReady && props.profiles.length === 0" class="text-sm text-muted" data-testid="hr-payroll-files-no-profiles">{{ t('hrPayroll.files.noProfiles') }}</p>
  </SharedFormSection>
</template>
