<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { owningListBack } from '@/utils/recordListOrigin'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/recruitment/jobs'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const canManage = computed(() => can('hr.recruitment.manage'))
const departments = useHrDepartments()
const { mutateAsync: createJob, isPending } = useCreateHrRecruitmentJob()

const name = ref('')
const departmentId = ref<number | null>(null)
const target = ref<number | null>(1)
const description = ref('')
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const serverField = ref('')

const departmentOptions = computed(() => (departments.data.value?.items ?? []).map(department => ({
  value: String(department.id),
  label: department.name,
})))
const dirty = computed(() => !saved.value && Boolean(name.value || departmentId.value || description.value))

function fieldError(field: string) {
  return serverField.value === field ? error.value : undefined
}
const nameError = computed(() => attempted.value && !name.value.trim() ? t('hrRecruitment.jobs.form.nameRequired') : fieldError('name'))

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = ''
  serverField.value = ''
  if (!name.value.trim()) return
  try {
    const job = await createJob({
      name: name.value.trim(),
      department_id: departmentId.value ?? undefined,
      no_of_recruitment: target.value ?? undefined,
      description: description.value.trim() || undefined,
    })
    saved.value = true
    await nextTick()
    await navigateTo({ path: `/hr/recruitment/jobs/${job.id}`, query: { returnTo: router.resolve(backTo.value).fullPath } }, { replace: true })
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
    serverField.value = cause instanceof ApiError ? cause.field ?? '' : ''
  }
}
</script>

<template>
  <SharedCreatePanel :title="t('hrRecruitment.jobs.new')" :back-to="backTo">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedForbiddenState v-if="!canManage" />
    <UForm v-else novalidate :state="{ name, departmentId, target, description }" class="webvue-form" method="post" data-testid="hr-recruitment-job-form" @submit="submit">
      <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error" />
      <SharedFormSection panel :title="t('hrRecruitment.jobs.form.details')">
        <div class="grid gap-4">
          <UFormField :label="t('hrRecruitment.jobs.columns.name')" name="hr-recruitment-job-name" required :error="nameError">
            <UInput
              id="hr-recruitment-job-name"
              v-model="name"
              class="w-full"
              :placeholder="t('hrRecruitment.jobs.form.namePlaceholder')"
              :disabled="!hydrated || isPending"
              data-testid="hr-recruitment-job-name"
            />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('hrRecruitment.jobs.columns.department')" name="hr-recruitment-job-department">
              <USelect
                id="hr-recruitment-job-department"
                class="w-full"
                :model-value="departmentId ? String(departmentId) : undefined"
                :items="departmentOptions"
                :placeholder="t('hrRecruitment.jobs.form.chooseDepartment')"
                :disabled="!hydrated || isPending"
                data-testid="hr-recruitment-job-department"
                @update:model-value="departmentId = $event ? Number($event) : null"
              />
            </UFormField>
            <UFormField :label="t('hrRecruitment.jobs.columns.target')" name="hr-recruitment-job-target" :hint="t('hrRecruitment.jobs.form.targetHint')">
              <UInputNumber id="hr-recruitment-job-target" v-model="target" class="w-full" :min="0" :disabled="!hydrated || isPending" data-testid="hr-recruitment-job-target" />
            </UFormField>
          </div>
          <UFormField :label="t('hrRecruitment.jobs.form.description')" name="hr-recruitment-job-description">
            <UTextarea id="hr-recruitment-job-description" v-model="description" class="w-full" :rows="4" :disabled="!hydrated || isPending" data-testid="hr-recruitment-job-description" />
          </UFormField>
        </div>
      </SharedFormSection>
      <SharedFormActions>
        <span class="text-xs text-muted">{{ t('hrRecruitment.form.requiredHint') }}</span>
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
          <UButton type="submit" color="primary" :disabled="!hydrated || isPending" :loading="isPending" :label="t('hrRecruitment.form.submit')" data-testid="hr-recruitment-job-submit" />
        </div>
      </SharedFormActions>
    </UForm>
  </SharedCreatePanel>
</template>
