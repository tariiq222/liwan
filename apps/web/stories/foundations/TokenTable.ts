import { defineComponent, h, nextTick, onMounted, ref, type PropType } from 'vue'

// Values are read from the live document, so the table follows the toolbar's mode and brand.
export const TokenTable = defineComponent({
  name: 'TokenTable',
  props: {
    names: { type: Array as PropType<string[]>, required: true },
    swatch: { type: String as PropType<'color' | 'radius' | 'shadow' | 'none'>, default: 'none' },
  },
  setup(props) {
    const values = ref<Record<string, string>>({})
    onMounted(async () => {
      await nextTick()
      requestAnimationFrame(() => {
        const style = getComputedStyle(document.documentElement)
        values.value = Object.fromEntries(props.names.map(name => [name, style.getPropertyValue(name).trim()]))
      })
    })
    const preview = (name: string) => {
      if (props.swatch === 'color') return h('span', { class: 'inline-block size-6 rounded border border-default', style: { background: `var(${name})` } })
      if (props.swatch === 'radius') return h('span', { class: 'inline-block size-8 border border-default bg-elevated', style: { borderRadius: `var(${name})` } })
      if (props.swatch === 'shadow') return h('span', { class: 'inline-block size-8 rounded bg-default', style: { boxShadow: `var(${name})` } })
      return null
    }
    return () => h('table', { class: 'w-full text-start text-sm' }, [
      h('tbody', props.names.map(name => h('tr', { key: name, class: 'border-t border-default' }, [
        h('td', { class: 'p-2' }, preview(name)),
        h('td', { class: 'p-2 font-mono text-xs', dir: 'ltr' }, name),
        h('td', { class: 'p-2 font-mono text-xs text-muted', dir: 'ltr' }, values.value[name] ?? ''),
      ]))),
    ])
  },
})
