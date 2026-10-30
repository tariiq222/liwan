import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import ProjectCharterForm from '../../app/components/pmo/projects/ProjectCharterForm.vue'
import FormSection from '@liwan/ui/app/components/shared/layout/FormSection.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { projectCreateDefaults } from '../fixtures/pmo'
import { storyContext } from '../support/context'

// The charter wizard: basics → the steps the chosen classification configures →
// review. "Save as draft" is offered on every step; the review step finalizes.
const meta = {
  title: 'Project/ProjectCharterForm',
  component: ProjectCharterForm,
  parameters: { layout: 'fullscreen', ...storyContext('apps/web/app/components/pmo/projects/ProjectCreateForm.vue:68') },
  args: { mode: 'create', createDefaults: projectCreateDefaults, defaultManagerName: 'Admin', disabled: false },
  render: args => ({
    components: { FormSection, PageContainer, ProjectCharterForm },
    setup: () => ({ args, t: useI18n().t }),
    template: `<main class="liwan-shell-main"><PageContainer width="form"><FormSection :title="t('projects.charter.title')" :description="t('projects.create.defaultsHint')"><ProjectCharterForm v-bind="args" /></FormSection></PageContainer></main>`,
  }),
} satisfies Meta<typeof ProjectCharterForm>
export default meta
type Story = StoryObj<typeof meta>

export const CreateWizard: Story = {
  name: 'إنشاء مشروع على خطوات',
  parameters: storyContext('apps/web/app/components/pmo/projects/ProjectCreateForm.vue:68', 'اختر التصنيف في الخطوة الأولى لتتغيّر الخطوات التالية. «حفظ كمسودة» متاح في كل خطوة.'),
}
export const WaitingForDefaults: Story = {
  name: 'قبل تحميل متطلبات الإنشاء',
  args: { createDefaults: undefined, disabled: true },
  parameters: storyContext('apps/web/app/components/pmo/projects/ProjectCreateForm.vue:68', 'النموذج معطّل حتى تصل متطلبات الإنشاء.'),
}
export const AiDraft: Story = {
  name: 'مسودة من LiwanOS AI',
  args: {
    initialDraft: {
      name: 'بوابة خدمات العملاء',
      description: 'بوابة موحّدة لطلبات العملاء ومتابعتها.',
      date_start: '2026-11-01',
      date_end: '2027-03-31',
      charter: { rationale: 'تقليل زمن الاستجابة للطلبات.', objectives: ['إطلاق البوابة', 'ربطها بقنوات الدعم'], scope: 'الطلبات الواردة من العملاء.' },
    },
    attestRequired: true,
  },
  parameters: storyContext('apps/web/app/components/pmo/projects/ProjectCreateForm.vue:68', 'مسودة جهّزها LiwanOS AI تفتح في نموذج الإنشاء نفسه. تظهر الشارة، ويشترط زر الإنشاء في الخطوة الأخيرة إقرار المستخدم.'),
}
