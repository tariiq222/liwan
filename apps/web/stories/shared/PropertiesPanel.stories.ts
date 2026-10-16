import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import PropertiesPanel from '@webvue/ui/app/components/shared/layout/PropertiesPanel.vue'
import PropertyRow from '@webvue/ui/app/components/shared/layout/PropertyRow.vue'
import { project } from '../fixtures/pmo'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/PropertiesPanel',
  component: PropertiesPanel,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('unused', 'عمود خصائص السجل: قائمة وصف واحدة من `SharedPropertyRow`.') },
} satisfies Meta<typeof PropertiesPanel>
export default meta
type Story = StoryObj

export const Default: Story = {
  name: 'خصائص مشروع',
  render: () => ({
    components: { PropertiesPanel, PropertyRow },
    setup: () => ({ t: useI18n().t, project }),
    template: `<div class="max-w-xs"><PropertiesPanel :title="t('states.properties')">
      <PropertyRow :label="t('projects.columns.manager')" :value="project.manager?.name" />
      <PropertyRow :label="t('projects.columns.progress')" :value="project.progress + '%'" />
      <PropertyRow :label="t('projects.columns.dateEnd')" :value="null" />
    </PropertiesPanel></div>`,
  }),
}
