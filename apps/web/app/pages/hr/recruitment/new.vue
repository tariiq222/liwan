<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { owningListBack } from '@/utils/recordListOrigin'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/recruitment'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const canManage = computed(() => can('hr.recruitment.manage'))
const jobs = useHrRecruitmentJobList(computed(() => ({ active: 'true' as const, limit: 100 })))
const { mutateAsync: createApplicant, isPending } = useCreateHrApplicant()

const partnerName = ref('')
const jobId = ref<number | null>(null)
const emailFrom = ref('')
const partnerPhone = ref('')
const availability = ref<string | null>(null)
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const serverField = ref('')

const jobOptions = computed(() => (jobs.data.value?.items ?? []).map(job => ({ value: String(job.id), label: job.name })))
const dirty = computed(() => !saved.value && Boolean(partnerName.value || jobId.value || emailFrom.value || partnerPhone.value || availability.value))

function fieldError(field: string) {
  return serverField.value === field ? error.value : undefined
}
const nameError = computed(() => attempted.value && !partnerName.value.trim() ? t('hrRecruitment.form.nameRequired') : fieldError('partner_name'))
const jobError = computed(() => attempted.value && !jobId.value ? t('hrRecruitment.form.jobRequired') : fieldError('job_id'))
const emailError = computed(() => fieldError('email_from'))

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = ''
  serverField.value = ''
  if (!partnerName.value.trim() || !jobId.value) return
  try {
    const applicant = await createApplicant({
      partner_name: partnerName.value.trim(),
      job_id: jobId.value,
      email_from: emailFrom.value.trim() || undefined,
      partner_phone: partnerPhone.value.trim() || undefined,
      availability: availability.value ?? undefined,
    })
    saved.value = true
    await nextTick()
    await navigateTo({ path: `/hr/recruitment/${applicant.id}`, query: { returnTo: router.resolve(backTo.value).fullPath } }, { replace: true })
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
    serverField.value = cause instanceof ApiError ? cause.field ?? '' : ''
  }
}
</script>

<template>
  <SharedCreatePanel :title="t('hrRecruitment.newApplicant')" :back-to="backTo">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedForbiddenState v-if="!canManage" />
    <SharedPageState v-else :loading="jobs.isLoading.value" :error="jobs.error.value" :empty="!jobs.isLoading.value && !jobOptions.length" :empty-text="t('hrRecruitment.form.noJobs')" @retry="jobs.refetch">
      <UForm novalidate :state="{ partnerName, jobId, emailFrom, partnerPhone, availability }" class="liwan-form" method="post" data-testid="hr-recruitment-applicant-form" @submit="submit">
        <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error" />
        <SharedFormSection panel :title="t('hrRecruitment.form.details')">
          <div class="grid gap-4">
            <UFormField :label="t('hrRecruitment.form.name')" name="hr-recruitment-name" required :error="nameError">
              <UInput
                id="hr-recruitment-name"
                v-model="partnerName"
                class="w-full"
                :placeholder="t('hrRecruitment.form.namePlaceholder')"
                :disabled="!hydrated || isPending"
                data-testid="hr-recruitment-name"
              />
            </UFormField>
            <UFormField :label="t('hrRecruitment.form.job')" name="hr-recruitment-job" required :error="jobError">
              <USelect
                id="hr-recruitment-job"
                class="w-full"
                :model-value="jobId ? String(jobId) : undefined"
                :items="jobOptions"
                :placeholder="t('hrRecruitment.form.chooseJob')"
                :disabled="!hydrated || isPending"
                data-testid="hr-recruitment-form-job"
                @update:model-value="jobId = $event ? Number($event) : null"
              />
            </UFormField>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField :label="t('hrRecruitment.form.email')" name="hr-recruitment-email" :error="emailError">
                <UInput id="hr-recruitment-email" v-model="emailFrom" type="email" class="w-full" :disabled="!hydrated || isPending" data-testid="hr-recruitment-email" />
              </UFormField>
              <UFormField :label="t('hrRecruitment.form.phone')" name="hr-recruitment-phone">
                <UInput id="hr-recruitment-phone" v-model="partnerPhone" class="w-full" :disabled="!hydrated || isPending" data-testid="hr-recruitment-phone" />
              </UFormField>
            </div>
            <UFormField :label="t('hrRecruitment.form.availability')" name="hr-recruitment-availability" :hint="t('hrRecruitment.form.availabilityHint')">
              <SharedDateField id="hr-recruitment-availability" v-model="availability" :disabled="!hydrated || isPending" />
            </UFormField>
          </div>
        </SharedFormSection>
        <SharedFormActions>
          <span class="text-xs text-muted">{{ t('hrRecruitment.form.requiredHint') }}</span>
          <div class="ms-auto flex flex-wrap items-center gap-2">
            <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
            <UButton type="submit" color="primary" :disabled="!hydrated || isPending" :loading="isPending" :label="t('hrRecruitment.form.submit')" data-testid="hr-recruitment-submit" />
          </div>
        </SharedFormActions>
      </UForm>
    </SharedPageState>
  </SharedCreatePanel>
</template>
