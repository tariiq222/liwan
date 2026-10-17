import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SubCard from '@webvue/ui/app/components/shared/layout/SubCard.vue'
import RecordSection from '@webvue/ui/app/components/shared/layout/RecordSection.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/SubCard',
  component: SubCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('unused', 'كتلة داخلية داخل بطاقة أو نموذج (صف ميثاق أو متابع أو مرحلة): 12px، حد رفيع، حشوة 12px. `tone="tinted"` للثانوي بلا حد، و`as` لعنصر آخر مثل `li`.') },
} satisfies Meta<typeof SubCard>
export default meta
type Story = StoryObj<typeof meta>

export const InsidePanel: Story = {
  name: 'داخل بطاقة',
  render: () => ({
    components: { SubCard, RecordSection },
    template: `<div class="max-w-xl bg-muted p-4"><RecordSection variant="panel" title="المراحل"><ul class="grid gap-3"><SubCard as="li"><p class="text-sm font-medium">المرحلة الأولى</p></SubCard><SubCard as="li" tone="tinted"><p class="text-sm text-muted">ملاحظة ثانوية</p></SubCard></ul></RecordSection></div>`,
  }),
}
