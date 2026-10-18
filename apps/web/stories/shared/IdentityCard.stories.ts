import type { Meta, StoryObj } from '@storybook/vue3-vite'
import IdentityCard from '@webvue/ui/app/components/shared/layout/IdentityCard.vue'
import StatusBadge from '@webvue/ui/app/components/shared/data/StatusBadge.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/IdentityCard',
  component: IdentityCard,
  parameters: { layout: 'padded', a11y: { test: 'error' }, ...storyContext('apps/web/app/components/hr/EmployeeCard.vue:15', 'بطاقة هوية سجل الشخص أو الوحدة (موظف، قسم، مستخدم): أفاتار `xl` والاسم `text-base` 600 وحبّة حالة في `#badge` وسطر فرعي نصّي (`subtitle`) أو بعلامات في `#subtitle`، داخل `SharedRecordSection variant="panel"`. الحقائق في لوحة الخصائص الجانبية.') },
  args: { id: 7, name: 'سارة القحطاني', subtitle: 'مهندسة برمجيات · التقنية' },
  render: args => ({
    components: { IdentityCard, StatusBadge },
    setup: () => ({ args }),
    template: '<div class="max-w-xl bg-muted p-4"><IdentityCard v-bind="args"><template #badge><StatusBadge size="sm" tone="success" label="نشط" /></template></IdentityCard></div>',
  }),
} satisfies Meta<typeof IdentityCard>
export default meta
type Story = StoryObj<typeof meta>

export const Employee: Story = { name: 'موظف' }
export const WithMarkupSubtitle: Story = {
  name: 'سطر فرعي بعلامات',
  render: () => ({
    components: { IdentityCard, StatusBadge },
    template: '<div class="max-w-xl bg-muted p-4"><IdentityCard :id="3" name="خالد العتيبي"><template #badge><StatusBadge size="sm" tone="neutral" label="مؤرشف" /></template><template #subtitle><bdi dir="ltr">khaled@example.com</bdi> · بلا موظف</template></IdentityCard></div>',
  }),
}
