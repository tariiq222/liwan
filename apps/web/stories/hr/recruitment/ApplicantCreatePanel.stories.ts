import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import CreatePanel from '@webvue/ui/app/components/shared/layout/CreatePanel.vue'
import FormSection from '@webvue/ui/app/components/shared/layout/FormSection.vue'
import FormActions from '@webvue/ui/app/components/shared/form/FormActions.vue'
import DateField from '@webvue/ui/app/components/shared/form/DateField.vue'
import { storyContext } from '../../support/context'

// The applicant create panel of /hr/recruitment/new: the route-backed SharedCreatePanel
// with the applicant fields. Static values, no requests.
const meta = {
  title: 'HR/Recruitment/ApplicantCreatePanel',
  component: CreatePanel,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/recruitment/new.vue:62', 'لوحة إنشاء المتقدم: `SharedFormSection panel` مع حقول الاسم والوظيفة والتواصل والجاهزية، وتذييل واحد `SharedFormActions`.'),
  },
  args: { title: 'متقدم جديد', backTo: '/hr/recruitment' },
  render: args => ({
    components: { CreatePanel, FormSection, FormActions, DateField },
    setup: () => ({ args, t: useI18n().t }),
    template: `<CreatePanel v-bind="args">
      <FormSection panel :title="t('hrRecruitment.form.details')">
        <div class="grid gap-4">
          <UFormField :label="t('hrRecruitment.form.name')" name="story-applicant-name" required>
            <UInput class="w-full" placeholder="ليلى الحربي" />
          </UFormField>
          <UFormField :label="t('hrRecruitment.form.job')" name="story-applicant-job" required>
            <USelect class="w-full" :items="[]" :placeholder="t('hrRecruitment.form.chooseJob')" />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('hrRecruitment.form.email')" name="story-applicant-email">
              <UInput class="w-full" type="email" placeholder="layla@example.com" />
            </UFormField>
            <UFormField :label="t('hrRecruitment.form.phone')" name="story-applicant-phone">
              <UInput class="w-full" placeholder="+966500000000" />
            </UFormField>
          </div>
          <UFormField :label="t('hrRecruitment.form.availability')" name="story-applicant-availability" :hint="t('hrRecruitment.form.availabilityHint')">
            <DateField :model-value="null" />
          </UFormField>
        </div>
      </FormSection>
      <FormActions>
        <span class="text-xs text-muted">{{ t('hrRecruitment.form.requiredHint') }}</span>
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="outline" :label="t('app.cancel')" />
          <UButton type="button" color="primary" :label="t('hrRecruitment.form.submit')" />
        </div>
      </FormActions>
    </CreatePanel>`,
  }),
} satisfies Meta<typeof CreatePanel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'لوحة إنشاء متقدم' }
