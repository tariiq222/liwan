import type { Meta, StoryObj } from '@storybook/vue3-vite'
import tokensCss from '../../app/assets/css/tokens.css?raw'
import { TokenTable } from './TokenTable'
import { groupTokens, isColorToken, parseTokenNames } from './tokens'

const groups = groupTokens(parseTokenNames(tokensCss))
const colorNames = (...prefixes: string[]) => groups
  .filter(group => prefixes.includes(group.prefix))
  .flatMap(group => group.names)
  .filter(isColorToken)

const table = (names: string[]): StoryObj => ({
  render: (_args, { globals }) => ({
    components: { TokenTable },
    setup: () => ({ names, key: JSON.stringify(globals) }),
    template: '<TokenTable :key="key" :names="names" swatch="color" />',
  }),
})

export default { title: 'Foundations/Colors' } satisfies Meta
export const Surfaces: StoryObj = { ...table(colorNames('nasq', 'ui', 'background', 'foreground', 'muted', 'popover', 'border', 'color', 'card', 'accent', 'destructive', 'secondary', 'input', 'ring')), name: 'الأسطح والنص والحدود' }
export const Brand: StoryObj = { ...table(colorNames('primary', 'chart', 'brand')), name: 'لون الهوية والرسوم' }
export const Status: StoryObj = { ...table(colorNames('status')), name: 'الحالات' }
export const Shell: StoryObj = { ...table(colorNames('sidebar', 'shell', 'project', 'rail', 'context', 'unread')), name: 'الغلاف' }
