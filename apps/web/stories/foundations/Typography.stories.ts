import type { Meta, StoryObj } from '@storybook/vue3-vite'
import tokensCss from '../../../../packages/ui/app/assets/css/tokens.css?raw'
import { TokenTable } from './TokenTable'
import { parseTokenNames } from './tokens'

const sizes = parseTokenNames(tokensCss).filter(name => name.startsWith('--text-'))
const classes = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl']

export default { title: 'Foundations/Typography' } satisfies Meta

export const Scale: StoryObj = {
  name: 'الخط والأحجام',
  render: (_args, { globals }) => ({
    components: { TokenTable },
    setup: () => ({ names: ['--font-sans', ...sizes], classes, key: JSON.stringify(globals) }),
    template: `<div class="space-y-6"><div class="space-y-3"><p v-for="size in classes" :key="size" :class="size" class="text-highlighted"><span class="font-mono text-xs text-muted" dir="ltr">{{ size }}</span> ويب فيو لإدارة المشاريع — WebVue 0123</p></div><TokenTable :key="key" :names="names" /></div>`,
  }),
}
