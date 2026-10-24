import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ShellNavigation from '@webvue/ui/app/components/shell/ShellNavigation.vue'
import { applicationNavigation } from '../../app/composables/nav/applicationNavigation'
import { contextLinksForModule } from '../../app/composables/nav/shellModules'
import { shellMe } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellNavigation', component: ShellNavigation,
  parameters: { layout: 'fullscreen' },
  args: { items: [], activeId: 'meetings', routeKey: '/meetings', expanded: true, hydrated: true, homeTo: '/', preference: 'open', surface: 'context', title: undefined, hideBrand: true },
} satisfies Meta<typeof ShellNavigation>
export default meta
type Story = StoryObj<typeof meta>
const render: Story['render'] = args => ({
  components: { ShellNavigation },
  setup() {
    const { t } = useI18n()
    const items = computed(() => applicationNavigation({ identity: shellMe, route: { path: '/meetings', fullPath: '/meetings', query: {}, params: {} }, activeId: 'meetings', contextLinks: contextLinksForModule('meetings', shellMe, '/meetings').map(link => ({ ...link, active: link.id === 'meetings' })), translate: t }))
    const visibleItems = computed(() => args.surface === 'context' ? items.value.filter(item => item.id === 'meetings') : items.value)
    return { args, items: visibleItems }
  },
  template: `<div class="webvue-shell"><div class="webvue-context-column" :class="{ 'bg-default': args.surface === 'drawer' }"><ShellNavigation v-bind="args" :items="items" /></div></div>`,
})
export const Expanded: Story = { name: 'قائمة التطبيق الداخلية', render, parameters: storyContext('apps/web/app/components/shell/AppSidebar.vue:27') }
export const Collapsed: Story = { ...Expanded, name: 'مطوية', args: { expanded: false, preference: 'closed' } }

export const Drawer: Story = { ...Expanded, name: 'قائمة التطبيقات في الجوال', args: { surface: 'drawer' } }
