import type { Meta, StoryObj } from '@storybook/vue3-vite'
import HomeFocus from '../../app/components/home/HomeFocus.vue'
import HomeIndicators from '../../app/components/home/HomeIndicators.vue'
import { storyContext } from '../support/context'
import { quietWorkHandlers, workHandlers } from '../work/workStoryData'

const meta = {
  title: 'Home/Today',
  parameters: { layout: 'padded', a11y: { test: 'error' }, msw: { handlers: { api: workHandlers } }, ...storyContext('apps/web/app/pages/index.vue', 'مؤشرات «يومي» الثلاثة وبطاقة «ابدأ بالأهم» من الصفوف نفسها التي تعرضها «مهامي»؛ تُخفى لمن لا يصل إلى «مهامي».') },
  render: () => ({ components: { HomeIndicators, HomeFocus }, template: '<div class="mx-auto flex max-w-3xl flex-col gap-4"><HomeIndicators /><HomeFocus /></div>' }),
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Busy: Story = { name: 'عمل ينتظر' }
export const Quiet: Story = { name: 'لا شيء عاجل', parameters: { msw: { handlers: { api: quietWorkHandlers } } } }
