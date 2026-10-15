import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import Checklist from '../../app/components/shared/data/Checklist.vue'
import { storyContext } from '../support/context'

const item = (id: number, name: string, extra = {}) => ({ id, name, to: `/my-tasks/${id}`, toggleLabel: 'إنجاز', toggleIcon: 'i-lucide-check', ...extra })
const items = [
  item(1, 'اطبع القائمة'),
  item(2, 'اشترِ الورق', { done: true, toggleLabel: 'إعادة فتح', toggleIcon: 'i-lucide-rotate-ccw' }),
  item(3, 'ألغِ الحجز', { cancelledLabel: 'ملغاة' }),
]

// The checklist runs no request: `add` and `toggle` are the app's async handlers.
const meta = {
  title: 'Shared/Checklist',
  component: Checklist,
  parameters: storyContext('apps/web/app/components/personal-tasks/MyTaskSubtasks.vue:55', 'قائمة قصيرة لبنود مرتبطة (المهام الفرعية): كل صف يفتح صفحته، مع تبديل اختياري للإنجاز ونموذج إضافة باسم. المعالجان `add` و`toggle` يمرّرهما التطبيق، ويمكن وضع شارة حالة في الفتحة `leading`.'),
  args: {
    items,
    emptyText: 'لا مهام فرعية بعد',
    addPlaceholder: 'عنوان المهمة الفرعية',
    addLabel: 'إضافة مهمة فرعية',
    add: fn(async () => true),
    toggle: fn(async () => {}),
    canAdd: true,
    doneLabel: 'منجزة',
  },
  render: args => ({
    components: { Checklist },
    setup: () => ({ args }),
    template: '<div class="max-w-xl"><Checklist v-bind="args" /></div>',
  }),
} satisfies Meta<typeof Checklist>
export default meta
type Story = StoryObj<typeof meta>

export const Editable: Story = { name: 'قابلة للتعديل' }
export const ReadOnly: Story = { name: 'للقراءة فقط', args: { canAdd: false, toggle: undefined } }
export const Empty: Story = { name: 'بلا بنود', args: { items: [] } }
export const WithError: Story = { name: 'خطأ من الخادم', args: { error: 'تعذر حفظ المهمة. حاول مرة أخرى.' } }
