import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import ProjectFieldHelp from '../../app/components/project/ProjectFieldHelp.vue'
import PageContainer from '../../app/components/shared/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Project/ProjectFieldHelp',
  component: ProjectFieldHelp,
  parameters: { layout: 'fullscreen' },
  args: { label: '', text: '' },
} satisfies Meta<typeof ProjectFieldHelp>
export default meta
type Story = StoryObj<typeof meta>

export const BesideFieldLabel: Story = {
  name: 'بجانب عنوان الحقل',
  parameters: storyContext('apps/web/app/components/project/ProjectCharterFields.vue:171', 'اضغط أيقونة ⓘ لفتح التلميح.'),
  render: args => ({
    components: { ProjectFieldHelp, PageContainer },
    setup() {
      const { t } = useI18n()
      const fieldLabel = t('projects.charter.fields.name')
      return { t, label: args.label || t('projects.charter.helpAria', { field: fieldLabel }), text: args.text || t('projects.charter.help.name') }
    },
    template: `<main class="nasq-shell-main"><PageContainer width="form"><div class="grid gap-6"><div class="grid gap-2"><div class="flex items-center gap-1"><label for="charter-name" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('projects.charter.fields.name') }}</label><ProjectFieldHelp :label="label" :text="text" /></div><UInput id="charter-name" class="w-full" /></div></div></PageContainer></main>`,
  }),
}
