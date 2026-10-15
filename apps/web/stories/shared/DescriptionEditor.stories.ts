import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import { fn } from 'storybook/test'
import DescriptionEditor from '../../app/components/shared/form/DescriptionEditor.vue'
import FormSection from '../../app/components/shared/layout/FormSection.vue'
import PageContainer from '../../app/components/shared/layout/PageContainer.vue'
import { ClientOnly } from '../../.storybook/nuxt-shims'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/DescriptionEditor',
  component: DescriptionEditor,
  parameters: { layout: 'fullscreen' },
  args: { modelValue: '', taskId: 0, readonly: false, onDraft: fn(), 'onUpdate:modelValue': fn() },
  render: args => ({
    components: { DescriptionEditor, FormSection, PageContainer, ClientOnly },
    setup: () => ({ args, t: useI18n().t }),
    template: `<main class="nasq-shell-main"><PageContainer width="form"><form class="space-y-8"><FormSection :title="t('meetingsUi.agenda')"><ClientOnly><DescriptionEditor v-bind="args" :aria-label="t('meetingsUx.agendaLabel')" /></ClientOnly></FormSection></form></PageContainer></main>`,
  }),
} satisfies Meta<typeof DescriptionEditor>
export default meta
type Story = StoryObj<typeof meta>

export const InFormSection: Story = { name: 'داخل قسم نموذج', parameters: storyContext('apps/web/app/pages/meetings/new.vue:189') }
export const WithContent: Story = {
  name: 'بمحتوى منسق',
  parameters: storyContext('apps/web/app/pages/meetings/new.vue:189'),
  args: { modelValue: '<p>جدول أعمال <strong>الاجتماع الشهري</strong></p><ul><li>مراجعة المخاطر</li><li>اعتماد الميزانية</li></ul><p><a href="https://example.com">رابط المرجع</a></p>' },
}
export const Readonly: Story = {
  name: 'للقراءة فقط',
  parameters: storyContext('apps/web/app/pages/meetings/[id]/minutes.vue:131'),
  args: { readonly: true, modelValue: '<p>محضر معتمد لا يمكن تعديله.</p>' },
}
