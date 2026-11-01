import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import WarningForm from '../../../app/components/hr/warnings/WarningForm.vue'
import CreatePanel from '@liwan/ui/app/components/shared/layout/CreatePanel.vue'
import { storyContext } from '../../support/context'
import { warningTypesFixture } from './fixtures'

// The warning create form inside the /hr/warnings/new SharedCreatePanel: it posts the exact request
// body and reports the created draft; the page owns the navigation.
const meta = {
  title: 'HR/Warnings/WarningForm',
  component: WarningForm,
  parameters: {
    layout: 'fullscreen',
    ...storyContext('apps/web/app/pages/hr/warnings/new.vue:32', 'نموذج الإنذار داخل `SharedCreatePanel`: الموظف ورقم تصعيده، ونوع الإنذار بترتيب خطورته، والتاريخ والسبب والإجراء التصحيحي، وتذييل واحد `SharedFormActions`.'),
  },
  args: {
    employees: [{ id: 7, name: 'ليلى الحربي' }, { id: 8, name: 'سارة القحطاني' }],
    types: warningTypesFixture.filter(type => type.active),
    backTo: '/hr/warnings',
  },
  render: args => ({
    components: { WarningForm, CreatePanel },
    setup: () => ({ args, t: useI18n().t }),
    template: '<CreatePanel :title="t(\'hrWarnings.new\')" back-to="/hr/warnings"><WarningForm v-bind="args" /></CreatePanel>',
  }),
} satisfies Meta<typeof WarningForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'نموذج الإنذار' }
export const NoTypes: Story = { name: 'بلا أنواع إنذار', args: { types: [] } }
