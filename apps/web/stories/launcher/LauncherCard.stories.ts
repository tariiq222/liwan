import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LauncherCard from '../../app/components/launcher/LauncherCard.vue'
import { storyContext } from '../support/context'
const meta = {
  title: 'Launcher/LauncherCard', component: LauncherCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/apps/index.vue:26') },
  args: {
    entry: { id: 'projects', labelKey: 'nav.projects', icon: 'i-lucide-folder-kanban', to: '/projects', actions: [
      { id: 'new-project', labelKey: 'nav.newProject', icon: 'i-lucide-plus', to: '/projects/new' },
      { id: 'new-task', labelKey: 'tasks.new', icon: 'i-lucide-check-square', to: '/tasks/new' },
    ] },
    description: 'مساحة واحدة لمتابعة المشاريع وحالتها والخطوة التالية.',
  },
  render: args => ({ components: { LauncherCard }, setup: () => ({ args }), template: '<div class="max-w-md"><LauncherCard v-bind="args" /></div>' }),
} satisfies Meta<typeof LauncherCard>
export default meta
type Story = StoryObj<typeof meta>
export const WithActions: Story = {}
export const ReadOnly: Story = { args: { entry: { ...meta.args.entry, actions: [] } } }
