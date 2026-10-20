<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { owningListBack } from '@/utils/recordListOrigin'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/recruitment/jobs'])
const id = computed(() => Number(route.params.jobId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const query = useHrRecruitmentJob(computed(() => (validId.value ? id.value : null)))
const job = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))

const canManage = computed(() => can('hr.recruitment.manage'))
const departments = useHrDepartments()
const { mutateAsync: updateJob, isPending } = useUpdateHrRecruitmentJob()

const form = reactive({
  name: '',
  departmentId: null as number | null,
  noOfRecruitment: 0,
  description: '',
  active: true,
})
const attempted = ref(false)
const error = ref('')
const serverField = ref('')

watch(job, (value) => {
  if (!value) return
  form.name = value.name
  form.departmentId = value.department?.id ?? null
  form.noOfRecruitment = value.no_of_recruitment
  form.description = value.description
  form.active = value.active
}, { immediate: true })

const departmentOptions = computed(() => (departments.data.value?.items ?? []).map(department => ({
  value: String(department.id),
  label: department.name,
})))
const dirty = computed(() => {
  const current = job.value
  if (!current) return false
  return form.name !== current.name
    || form.departmentId !== (current.department?.id ?? null)
    || form.noOfRecruitment !== current.no_of_recruitment
    || form.description !== current.description
    || form.active !== current.active
})

function fieldError(field: string) {
  return serverField.value === field ? error.value : undefined
}
const nameError = computed(() => attempted.value && !form.name.trim() ? t('hrRecruitment.jobs.form.nameRequired') : fieldError('name'))

function resetForm() {
  const current = job.value
  if (!current) return
  form.name = current.name
  form.departmentId = current.department?.id ?? null
  form.noOfRecruitment = current.no_of_recruitment
  form.description = current.description
  form.active = current.active
  attempted.value = false
  error.value = ''
  serverField.value = ''
}

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = ''
  serverField.value = ''
  if (!form.name.trim()) return
  try {
    // The answer replaces the detail cache, and the watch below re-syncs the form from it.
    await updateJob({
      id: id.value,
      body: {
        name: form.name.trim(),
        department_id: form.departmentId,
        no_of_recruitment: form.noOfRecruitment,
        description: form.description,
        active: form.active,
      },
    })
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
    serverField.value = cause instanceof ApiError ? cause.field ?? '' : ''
  }
}

const applicantsTo = computed(() => ({ path: '/hr/recruitment', query: { job_id: String(id.value) } }))
</script>

<template>
  <SharedRecordPage
    :keep-content="!!job"
    :title="job?.name || t('hrRecruitment.jobs.title')"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="job" #actions>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-users"
        :to="applicantsTo"
        :disabled="!hydrated"
        :label="t('hrRecruitment.jobs.viewApplicants')"
        data-testid="hr-recruitment-job-applicants"
      />
    </template>

    <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error" />

    <SharedIdentityCard
      v-if="job"
      :id="job.id"
      :name="job.name"
      :subtitle="job.department?.name || t('hrRecruitment.noDepartment')"
    >
      <template #badge>
        <SharedStatusBadge
          size="sm"
          :tone="job.active ? 'success' : 'neutral'"
          :label="job.active ? t('hrRecruitment.jobs.state.active') : t('hrRecruitment.jobs.state.archived')"
          data-testid="hr-recruitment-job-state"
        />
      </template>
    </SharedIdentityCard>

    <SharedRecordSection v-if="job" variant="panel" :title="t('hrRecruitment.jobs.form.details')">
      <UForm novalidate :state="form" class="webvue-form" method="post" data-testid="hr-recruitment-job-edit" @submit="submit">
        <SharedUnsavedChanges :dirty="dirty" />
        <div class="grid gap-4">
          <UFormField :label="t('hrRecruitment.jobs.columns.name')" name="hr-recruitment-edit-name" required :error="nameError">
            <UInput
              id="hr-recruitment-edit-name"
              v-model="form.name"
              class="w-full"
              :disabled="!hydrated || !canManage || isPending"
              data-testid="hr-recruitment-job-edit-name"
            />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('hrRecruitment.jobs.columns.department')" name="hr-recruitment-edit-department">
              <USelect
                id="hr-recruitment-edit-department"
                class="w-full"
                :model-value="form.departmentId ? String(form.departmentId) : undefined"
                :items="departmentOptions"
                :placeholder="t('hrRecruitment.jobs.form.chooseDepartment')"
                :disabled="!hydrated || !canManage || isPending"
                data-testid="hr-recruitment-job-edit-department"
                @update:model-value="form.departmentId = $event ? Number($event) : null"
              />
            </UFormField>
            <UFormField :label="t('hrRecruitment.jobs.columns.target')" name="hr-recruitment-edit-target" :hint="t('hrRecruitment.jobs.form.targetHint')">
              <UInputNumber id="hr-recruitment-edit-target" v-model="form.noOfRecruitment" class="w-full" :min="0" :disabled="!hydrated || !canManage || isPending" data-testid="hr-recruitment-job-edit-target" />
            </UFormField>
          </div>
          <UFormField :label="t('hrRecruitment.jobs.form.description')" name="hr-recruitment-edit-description">
            <UTextarea id="hr-recruitment-edit-description" v-model="form.description" class="w-full" :rows="4" :disabled="!hydrated || !canManage || isPending" data-testid="hr-recruitment-job-edit-description" />
          </UFormField>
          <USwitch
            id="hr-recruitment-edit-active"
            :model-value="form.active"
            :label="t('hrRecruitment.jobs.form.active')"
            :disabled="!hydrated || !canManage || isPending"
            data-testid="hr-recruitment-job-edit-active"
            @update:model-value="form.active = $event"
          />
        </div>
        <SharedFormActions>
          <span class="text-xs text-muted">{{ t('hrRecruitment.jobs.form.requiredHint') }}</span>
          <div class="ms-auto flex flex-wrap items-center gap-2">
            <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || isPending || !dirty" :label="t('app.cancel')" @click="resetForm" />
            <UButton type="submit" color="primary" :disabled="!hydrated || !canManage || isPending || !dirty" :loading="isPending" :label="t('app.save')" data-testid="hr-recruitment-job-save" />
          </div>
        </SharedFormActions>
      </UForm>
    </SharedRecordSection>

    <template v-if="job" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('hrRecruitment.jobs.columns.target')" :value="job.no_of_recruitment" />
        <SharedPropertyRow :label="t('hrRecruitment.jobs.columns.applications')" :value="job.application_count" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
