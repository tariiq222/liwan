import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { http, HttpResponse } from 'msw'
import HomeApps from '../../app/components/home/HomeApps.vue'
import type { AppCardModel } from '../../app/composables/useAppCards'
import { tasksAppCard } from '../../app/modules/tasks/appCard'
import { storyContext } from '../support/context'
import { workHandlers } from '../work/workStoryData'

const card = (id: string, labelKey: string, icon: AppCardModel['icon'], category: AppCardModel['category'], plan: AppCardModel['plan'], surface: AppCardModel['surface'], figures: AppCardModel['figures'] = []): AppCardModel =>
  ({ id, labelKey, icon, to: `/${id}`, pinnable: true, category, plan, surface, figures })
const cards = [
  card('tasks', 'nav.myTasks', 'i-lucide-check-square', 'team', 'included', 'lav', tasksAppCard.figures),
  card('crm', 'nav.crm', 'i-lucide-handshake', 'sales', 'addon', 'navy'),
  card('inbox', 'inbox.title', 'i-lucide-messages-square', 'sales', 'addon', 'mint'),
  card('projects', 'nav.projects', 'i-lucide-folder-kanban', 'team', 'addon', 'indigo'),
  card('hr', 'nav.hr', 'i-lucide-users', 'team', 'addon', 'coral'),
  card('finance', 'nav.finance', 'i-lucide-landmark', 'sales', 'addon', 'forest'),
]

const meta = {
  title: 'Home/Apps',
  component: HomeApps,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    msw: { handlers: { api: [http.get('/api/v1/my-tasks/summary', () => HttpResponse.json({ total: 12, open: 7, overdue: 2, done: 5 })), ...workHandlers] } },
    ...storyContext('apps/web/app/pages/index.vue:25', '«تطبيقاتك»: بطاقات متدرجة على سكة تقف عند كل بطاقة، بأرقام حية ومعاينة لما يحتاج المستخدم في كل تطبيق، وشرائح تصفية بالفئة.'),
  },
  args: { cards },
  render: args => ({ components: { HomeApps }, setup: () => ({ args }), template: '<div class="mx-auto max-w-5xl"><HomeApps v-bind="args" /></div>' }),
} satisfies Meta<typeof HomeApps>
export default meta
type Story = StoryObj<typeof meta>

export const Rail: Story = { name: 'كل التطبيقات' }
export const OneCategory: Story = { name: 'فئة واحدة بلا شرائح', args: { cards: cards.filter(item => item.category === 'team') } }
