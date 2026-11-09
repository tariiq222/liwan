import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LauncherRow from '../../app/components/launcher/LauncherRow.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Launcher/LauncherRow',
  component: LauncherRow,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/pages/apps/index.vue:28', 'صف تطبيق في «كل التطبيقات»: البلاطة والاسم والوصف وتثبيت في القائمة الجانبية وزر الفتح.') },
  args: {
    card: { id: 'projects', labelKey: 'nav.projects', icon: 'i-lucide-folder-kanban', to: '/projects', pinnable: true, category: 'team', plan: 'addon', surface: 'indigo', figures: [] },
    description: 'مساحة واحدة لمتابعة المشاريع وحالتها والخطوة التالية.',
  },
  render: args => ({ components: { LauncherRow }, setup: () => ({ args }), template: '<div class="max-w-md"><LauncherRow v-bind="args" /></div>' }),
} satisfies Meta<typeof LauncherRow>
export default meta
type Story = StoryObj<typeof meta>

export const Unpinned: Story = { name: 'غير مثبّت' }
export const Pinned: Story = { name: 'مثبّت', args: { pinned: true } }
export const AtLimit: Story = { name: 'عند حد التثبيت', args: { pinDisabled: true } }
export const AlwaysInSidebar: Story = { name: 'ثابت في القائمة', args: { card: { ...meta.args.card, pinnable: false } } }
