import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LinkCard from '@webvue/ui/app/components/shared/layout/LinkCard.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/LinkCard',
  component: LinkCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/services/ServicesGroups.vue:18', 'بطاقة وجهة: أيقونة في دائرة 40px وعنوان ووصف من سطر واحد، والبطاقة كلها رابط (اسمه العنوان ووصفه الوصف). عند التمرير ترتفع 1px بظل خفيف وحلقة أساسية، ولها حلقة تركيز. للروابط التنقلية لا للإجراءات.') },
} satisfies Meta<typeof LinkCard>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'وجهة',
  args: { to: '/projects', icon: 'i-lucide-folder-kanban', title: 'المشاريع', description: 'تابع مشاريعك وتقدمها' },
  render: args => ({ components: { LinkCard }, setup: () => ({ args }), template: '<div class="max-w-sm bg-muted p-4"><LinkCard v-bind="args" /></div>' }),
}

export const WithoutDescription: Story = {
  name: 'بلا وصف',
  args: { to: '/tasks', icon: 'i-lucide-list-checks', title: 'المهام' },
  render: args => ({ components: { LinkCard }, setup: () => ({ args }), template: '<div class="max-w-sm bg-muted p-4"><LinkCard v-bind="args" /></div>' }),
}

export const Tones: Story = {
  name: 'الدرجات',
  args: { to: '/x', icon: 'i-lucide-bell', title: 'الإشعارات' },
  render: () => ({
    components: { LinkCard },
    template: `<div class="grid max-w-3xl gap-3 bg-muted p-4 sm:grid-cols-2"><LinkCard to="/a" icon="i-lucide-bell" title="أساسي" description="الافتراضي" /><LinkCard to="/b" icon="i-lucide-triangle-alert" title="تحذير" tone="warning" /><LinkCard to="/c" icon="i-lucide-circle-check" title="نجاح" tone="success" /><LinkCard to="/d" icon="i-lucide-circle-x" title="خطر" tone="danger" /></div>`,
  }),
}
