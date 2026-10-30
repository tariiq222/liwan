import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import type { HrApplicant } from '@liwan/contracts'
import RecordPage from '@liwan/ui/app/components/shared/layout/RecordPage.vue'
import RecordSection from '@liwan/ui/app/components/shared/layout/RecordSection.vue'
import IdentityCard from '@liwan/ui/app/components/shared/layout/IdentityCard.vue'
import PropertiesPanel from '@liwan/ui/app/components/shared/layout/PropertiesPanel.vue'
import PropertyRow from '@liwan/ui/app/components/shared/layout/PropertyRow.vue'
import InlineConfirm from '@liwan/ui/app/components/shared/form/InlineConfirm.vue'
import StatusBadge from '@liwan/ui/app/components/shared/data/StatusBadge.vue'
import { storyContext } from '../../support/context'

// The applicant record of /hr/recruitment/<id>: stage and priority controls, the inline
// confirmations of refuse/reset/hire and the aside facts. Static fixtures, no requests.
const applicant: HrApplicant = {
  id: 7, partner_name: 'ليلى الحربي', email_from: 'layla@example.com', partner_phone: '+966500000000',
  job: { id: 3, name: 'مهندس واجهات' }, department: { id: 1, name: 'الهندسة' },
  stage: { id: 11, name: 'المقابلة الأولى' }, status: 'ongoing', priority: '2', availability: '2026-11-01',
  refuse_reason: null, employee: null, applied_on: '2026-10-18T08:00:00Z', active: true,
}

const meta = {
  title: 'HR/Recruitment/ApplicantRecord',
  component: RecordPage,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/recruitment/[applicantId].vue:105', 'سجل المتقدم: بطاقة الهوية بحالة التوظيف، وضبط المرحلة والتقييم في المكان، وتأكيدات داخلية للرفض وإعادة المرحلة والتعيين، ووقائع السجل في الشريط الجانبي.'),
  },
  args: { title: applicant.partner_name, backTo: '/hr/recruitment' },
  render: args => ({
    components: { RecordPage, RecordSection, IdentityCard, PropertiesPanel, PropertyRow, InlineConfirm, StatusBadge },
    setup: () => ({ args, applicant, t: useI18n().t }),
    template: `<RecordPage v-bind="args">
      <template #actions>
        <UButton color="primary" :label="t('hrRecruitment.hire.action')" />
        <UButton color="neutral" variant="outline" :label="t('hrRecruitment.reset.action')" />
        <UButton color="error" variant="outline" :label="t('hrRecruitment.refuse.action')" />
      </template>
      <InlineConfirm
        :title="t('hrRecruitment.refuse.confirmTitle')"
        :confirm-label="t('hrRecruitment.refuse.action')"
        color="error"
      >
        <p>{{ t('hrRecruitment.refuse.reason') }}</p>
      </InlineConfirm>
      <IdentityCard :id="applicant.id" :name="applicant.partner_name" :subtitle="applicant.job?.name">
        <template #badge>
          <StatusBadge size="sm" tone="info" :label="t('hrRecruitment.status.' + applicant.status)" />
        </template>
      </IdentityCard>
      <RecordSection variant="panel" :title="t('hrRecruitment.detail.pipeline')">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('hrRecruitment.columns.stage')" name="story-applicant-stage">
            <USelect class="w-full" :items="[]" :placeholder="applicant.stage?.name" />
          </UFormField>
          <UFormField :label="t('hrRecruitment.columns.priority')" name="story-applicant-priority">
            <USelect class="w-full" :items="[]" :placeholder="t('hrRecruitment.priority.' + applicant.priority)" />
          </UFormField>
        </div>
      </RecordSection>
      <RecordSection variant="panel" :title="t('hrRecruitment.detail.contact')">
        <PropertiesPanel>
          <PropertyRow :label="t('hrRecruitment.form.email')" :value="applicant.email_from" />
          <PropertyRow :label="t('hrRecruitment.form.phone')" :value="applicant.partner_phone" />
          <PropertyRow :label="t('hrRecruitment.form.availability')" :value="applicant.availability" />
          <PropertyRow :label="t('hrRecruitment.detail.appliedOn')" value="18/10/2026 11:00" />
        </PropertiesPanel>
      </RecordSection>
      <template #aside>
        <PropertiesPanel>
          <PropertyRow :label="t('hrRecruitment.columns.job')" :value="applicant.job?.name" />
          <PropertyRow :label="t('hrRecruitment.detail.department')" :value="applicant.department?.name" />
          <PropertyRow :label="t('hrRecruitment.detail.employee')" :value="t('hrRecruitment.detail.noEmployee')" />
          <PropertyRow :label="t('hrRecruitment.detail.refuseReason')" :value="t('hrRecruitment.detail.noRefuseReason')" />
        </PropertiesPanel>
      </template>
    </RecordPage>`,
  }),
} satisfies Meta<typeof RecordPage>

export default meta
type Story = StoryObj<typeof meta>

export const Ongoing: Story = { name: 'متقدم قيد التوظيف' }
