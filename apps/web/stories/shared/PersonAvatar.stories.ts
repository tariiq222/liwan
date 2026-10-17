import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PersonAvatar from '@webvue/ui/app/components/shared/data/PersonAvatar.vue'
import { storyContext } from '../support/context'

// Photos are generated data URLs, so the story needs no external image.
const photo = (hue: number) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" fill="hsl(${hue} 45% 62%)"/><circle cx="28" cy="22" r="10" fill="hsl(${hue} 30% 88%)"/><ellipse cx="28" cy="52" rx="18" ry="16" fill="hsl(${hue} 30% 88%)"/></svg>`)}`
const names = ['سارة القحطاني', 'محمد العتيبي', 'فاطمة الزهراني', 'عبدالله الشمري', 'منى الحربي', 'أحمد السبيعي']
const group = (count: number, withPhotos = false) => names.slice(0, count).map((name, index) => ({ id: index + 2, name, src: withPhotos && index % 2 === 0 ? photo(200 + index * 40) : undefined }))

const meta = {
  title: 'Shared/PersonAvatar',
  component: PersonAvatar,
  parameters: storyContext('apps/web/app/components/pmo/tasks/TaskTable.vue:117', 'أفاتارات بلا نص اسم: شخص واحد دائرة، وأكثر من شخص كومة متراكبة (حتى 3، الأول فوق، هامش منطقي سالب وحلقة بلون السطح) ثم دائرة `+N` واحدة. الصورة اختيارية (`src`) وإلا حروف الاسم بلون ناعم ثابت لكل شخص. المجموعة كلها تلميح واحد واسم مسموع.'),
  args: { people: group(1) },
  render: args => ({
    components: { PersonAvatar },
    setup: () => ({ args }),
    template: '<div class="w-56"><PersonAvatar v-bind="args" /></div>',
  }),
} satisfies Meta<typeof PersonAvatar>
export default meta
type Story = StoryObj<typeof meta>

export const Single: Story = { name: 'شخص واحد' }
export const Stack: Story = {
  name: 'كومة متراكبة (1 إلى 6)',
  render: () => ({
    components: { PersonAvatar },
    setup: () => ({ groups: [1, 2, 3, 4, 5, 6].map(count => group(count)), photos: [2, 3, 4, 6].map(count => group(count, true)) }),
    template: '<div class="grid w-72 gap-4"><PersonAvatar v-for="people in groups" :key="people.length" :people="people" /><hr class="border-default" /><PersonAvatar v-for="people in photos" :key="`p${people.length}`" :people="people" /></div>',
  }),
}
export const Nobody: Story = { name: 'بلا مسؤول', args: { people: [] } }
