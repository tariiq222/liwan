import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import ConversationLayout from '@nasq/ui/app/components/shared/layout/ConversationLayout.vue'
import EmptyState from '@nasq/ui/app/components/shared/feedback/EmptyState.vue'
import { storyContext } from '../support/context'

const PEOPLE = ['سارة القحطاني', 'فريق المشاريع', 'خالد العتيبي']

const meta = {
  title: 'Shared/ConversationLayout',
  component: ConversationLayout,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('apps/web/app/components/chat/ChatWorkspace.vue:15', 'قالب المحادثة: من 768px تكون القائمة لوحة الشريط السياقي ويعرض القالب المحادثة فقط؛ تحتها تملأ القائمة الصفحة حتى تُختار محادثة. من 1280px تكون المعلومات جانبية؛ دون ذلك تستخدم المنطقة المتاحة وتحل محل المحادثة مع حفظ المسودة.'),
  },
  args: { hasSelection: true, infoOpen: false },
  render: args => ({
    components: { ConversationLayout, EmptyState },
    setup: () => ({ args, t: useI18n().t, people: PEOPLE }),
    template: `<ConversationLayout v-bind="args">
      <template #list>
        <h1 class="px-4 pt-4 text-lg font-semibold text-highlighted">{{ t('chat.title') }}</h1>
        <ul class="grid divide-y divide-default" :aria-label="t('chat.title')">
          <li v-for="name in people" :key="name" class="p-4 text-sm text-highlighted">{{ name }}</li>
        </ul>
      </template>
      <template #header>
        <div class="flex items-center gap-3 border-b border-default bg-default px-3 py-2">
          <h1 class="truncate text-lg font-semibold text-highlighted">{{ people[0] }}</h1>
        </div>
      </template>
      <template #thread>
        <div class="flex-1 overflow-y-auto bg-muted p-4">
          <p class="max-w-sm rounded-lg bg-default p-3 text-sm text-default">صباح الخير، أرفقت مسودة الخطة.</p>
        </div>
      </template>
      <template #composer>
        <div class="border-t border-default bg-default p-3">
          <UInput class="w-full" :placeholder="t('chat.composerPlaceholder')" :aria-label="t('chat.composerPlaceholder')" />
        </div>
      </template>
      <template #info="{ headingLevel }">
        <div class="grid gap-2 p-4">
          <component :is="headingLevel" class="font-semibold text-highlighted">{{ t('chat.info') }}</component>
          <p class="text-sm text-muted">{{ people[0] }}</p>
        </div>
      </template>
      <template #empty>
        <h1 class="sr-only">{{ t('chat.title') }}</h1>
        <EmptyState :title="t('chat.select')" :description="t('chat.description')" />
      </template>
    </ConversationLayout>`,
  }),
} satisfies Meta<typeof ConversationLayout>
export default meta
type Story = StoryObj<typeof meta>

export const Selected: Story = { name: 'محادثة مختارة' }
export const NothingSelected: Story = { name: 'لا محادثة مختارة', args: { hasSelection: false } }
export const Info: Story = { name: 'مع لوحة المعلومات', args: { infoOpen: true } }
