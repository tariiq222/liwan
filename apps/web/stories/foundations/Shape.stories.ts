import type { Meta, StoryObj } from '@storybook/vue3-vite'
import componentsCss from '../../app/assets/css/components.css?raw'
import tokensCss from '../../app/assets/css/tokens.css?raw'
import { TokenTable } from './TokenTable'
import { parseTokenNames } from './tokens'

const names = [...new Set([...parseTokenNames(tokensCss), ...parseTokenNames(componentsCss)])]
const radius = names.filter(name => name.includes('radius'))
const elevation = names.filter(name => name.startsWith('--elevation-'))
const layers = names.filter(name => name.includes('-z-'))
const elevationClasses = [1, 2, 3, 4].map(level => `nasq-elevation-${level}`)

export default { title: 'Foundations/Shape' } satisfies Meta

export const RadiusAndElevation: StoryObj = {
  name: 'الزوايا والظلال',
  render: (_args, { globals }) => ({
    components: { TokenTable },
    setup: () => ({ radius, elevation, elevationClasses, key: JSON.stringify(globals) }),
    template: `<div class="space-y-6"><div class="flex flex-wrap gap-6"><div v-for="level in elevationClasses" :key="level" :class="level" class="grid size-28 place-items-center rounded-[14px] bg-default text-xs"><span dir="ltr">{{ level }}</span></div></div><TokenTable :key="key + 'r'" :names="radius" swatch="radius" /><TokenTable :key="key + 'e'" :names="elevation" swatch="shadow" /></div>`,
  }),
}

export const Layers: StoryObj = {
  name: 'طبقات العرض',
  render: (_args, { globals }) => ({
    components: { TokenTable },
    setup: () => ({ layers, key: JSON.stringify(globals) }),
    template: '<TokenTable :key="key" :names="layers" />',
  }),
}
