import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import ContextSidebar from '../../app/components/shell/ContextSidebar.vue'
import { projectsSidebar, sectionedSidebar } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ContextSidebar',
  component: ContextSidebar,
  parameters: { layout: 'fullscreen' },
  args: {
    title: '', createLinks: projectsSidebar.createLinks, sections: projectsSidebar.sections, showNav: true,
    counts: { tasks: 7 }, expanded: true, hydrated: true, panel: null, renderPanel: false, panelWidth: 'default', motionKey: 'module:projects',
  },
} satisfies Meta<typeof ContextSidebar>
export default meta
type Story = StoryObj<typeof meta>

const render = (titleKey: string) => (args: Story['args']) => ({
  components: { ContextSidebar },
  setup: () => ({ args, t: useI18n().t }),
  template: `<div class="webvue-shell min-h-svh"><div class="webvue-context-column"><ContextSidebar v-bind="args" :title="t('${titleKey}')" /></div></div>`,
})

export const Projects: Story = { name: 'المشاريع مع عدّاد', parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:44'), render: render('nav.projects') }
export const WithSections: Story = {
  name: 'أقسام بعناوين',
  parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:44'),
  args: { createLinks: sectionedSidebar.createLinks, sections: sectionedSidebar.sections, counts: {} },
  render: render('nav.settings'),
}
export const Collapsed: Story = { ...Projects, name: 'مطوية', args: { expanded: false } }

export const AutomaticTablet: Story = { ...Projects, name: 'طي تلقائي على التابلت', args: { preference: 'auto', expanded: false } }
