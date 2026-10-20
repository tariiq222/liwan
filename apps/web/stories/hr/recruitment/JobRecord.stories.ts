import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import type { HrRecruitmentJob } from '@webvue/contracts'
import RecordPage from '@webvue/ui/app/components/shared/layout/RecordPage.vue'
import RecordSection from '@webvue/ui/app/components/shared/layout/RecordSection.vue'
import IdentityCard from '@webvue/ui/app/components/shared/layout/IdentityCard.vue'
import PropertiesPanel from '@webvue/ui/app/components/shared/layout/PropertiesPanel.vue'
import PropertyRow from '@webvue/ui/app/components/shared/layout/PropertyRow.vue'
import FormActions from '@webvue/ui/app/components/shared/form/FormActions.vue'
import StatusBadge from '@webvue/ui/app/components/shared/data/StatusBadge.vue'
import { storyContext } from '../../support/context'

// The job-position record of /hr/recruitment/jobs/<id>: the position fields as one routed
// page form, and the counts in the aside. Static fixtures, no requests.
const job: HrRecruitmentJob = {
  id: 3, name: 'مهندس واجهات', department: { id: 1, name: 'الهندسة' },
  no_of_recruitment: 2, application_count: 6, description: 'مسؤولية بناء واجهات العميل', active: true,
}

const meta = {
  title: 'HR/Recruitment/JobRecord',
  component: RecordPage,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/recruitment/jobs/[jobId].vue:102', 'سجل الوظيفة: بطاقة الهوية بحالتها، ونموذج الوظيفة داخل الصفحة بتذييل `SharedFormActions`، ووقائع العدد المطلوب والمتقدمين في الشريط الجانبي.'),
  },
  args: { title: job.name, backTo: '/hr/recruitment/jobs' },
  render: args => ({
    components: { RecordPage, RecordSection, IdentityCard, PropertiesPanel, PropertyRow, FormActions, StatusBadge },
    setup: () => ({ args, job, t: useI18n().t }),
    template: `<RecordPage v-bind="args">
      <IdentityCard :id="job.id" :name="job.name" :subtitle="job.department?.name">
        <template #badge>
          <StatusBadge size="sm" tone="success" :label="t('hrRecruitment.jobs.state.active')" />
        </template>
      </IdentityCard>
      <RecordSection variant="panel" :title="t('hrRecruitment.jobs.form.details')">
        <div class="grid gap-4">
          <UFormField :label="t('hrRecruitment.jobs.columns.name')" name="story-job-name" required>
            <UInput class="w-full" :model-value="job.name" />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('hrRecruitment.jobs.columns.department')" name="story-job-department">
              <USelect class="w-full" :items="[]" :placeholder="job.department?.name" />
            </UFormField>
            <UFormField :label="t('hrRecruitment.jobs.columns.target')" name="story-job-target" :hint="t('hrRecruitment.jobs.form.targetHint')">
              <UInputNumber class="w-full" :model-value="job.no_of_recruitment" />
            </UFormField>
          </div>
          <UFormField :label="t('hrRecruitment.jobs.form.description')" name="story-job-description">
            <UTextarea class="w-full" :rows="3" :model-value="job.description" />
          </UFormField>
          <USwitch :model-value="job.active" :label="t('hrRecruitment.jobs.form.active')" />
        </div>
        <FormActions>
          <span class="text-xs text-muted">{{ t('hrRecruitment.jobs.form.requiredHint') }}</span>
          <div class="ms-auto flex flex-wrap items-center gap-2">
            <UButton type="button" color="neutral" variant="outline" :label="t('app.cancel')" />
            <UButton type="button" color="primary" :label="t('app.save')" />
          </div>
        </FormActions>
      </RecordSection>
      <template #aside>
        <PropertiesPanel>
          <PropertyRow :label="t('hrRecruitment.jobs.columns.target')" :value="job.no_of_recruitment" />
          <PropertyRow :label="t('hrRecruitment.jobs.columns.applications')" :value="job.application_count" />
        </PropertiesPanel>
      </template>
    </RecordPage>`,
  }),
} satisfies Meta<typeof RecordPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'سجل الوظيفة' }
