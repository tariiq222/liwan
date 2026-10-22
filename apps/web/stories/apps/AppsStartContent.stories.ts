import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AppsStartContent from '../../app/components/apps/AppsStartContent.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Apps/AppsStartContent',
  component: AppsStartContent,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext('apps/web/app/pages/apps/[id].vue:20', 'جسم صفحة بدء التطبيق: قسم «يحتاج انتباهك» (يُخفى حين لا شيء) ثم «ابدأ من هنا» ببطاقات صفحات التطبيق وإجراءات الإنشاء المثبتة، كلها من بيان التطبيق.'),
  },
  render: args => ({ components: { AppsStartContent }, setup: () => ({ args }), template: '<div class="mx-auto max-w-3xl"><AppsStartContent v-bind="args" /></div>' }),
} satisfies Meta<typeof AppsStartContent>
export default meta
type Story = StoryObj<typeof meta>

const cards = [
  { id: '/operations', labelKey: 'operations.nav.mine', icon: 'i-lucide-files', to: '/operations' },
  { id: '/operations/pending', labelKey: 'operations.nav.pending', icon: 'i-lucide-list-checks', to: '/operations/pending' },
] as const
const creates = [{ id: 'new-operation', labelKey: 'operations.newRequest', icon: 'i-lucide-plus', to: '/operations/new' }] as const

export const WithAttention: Story = {
  name: 'مع ما يحتاج انتباهًا',
  args: {
    attention: [
      { id: 'a:1', module: 'operations', work: 'decide', tone: 'urgent', label: 'طلب شراء أجهزة', to: '/operations/12', caption: 'بانتظار موافقتك منذ يومين' },
      { id: 'a:2', module: 'operations', work: 'decide', tone: 'normal', label: 'طلب صيانة المكتب', to: '/operations/15', caption: 'بانتظار موافقتك' },
    ],
    cards: [...cards],
    creates: [...creates],
  },
}

export const WithoutAttention: Story = {
  name: 'بلا ما يحتاج انتباهًا',
  args: { attention: [], cards: [...cards], creates: [...creates] },
}
