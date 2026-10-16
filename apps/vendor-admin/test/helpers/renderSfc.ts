import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineComponent, h, reactive, type Component, type VNode } from 'vue'
import { DEFAULT_STUBS, loadShared, renderShared, type SharedRenderOptions } from '../../../../packages/ui/test/helpers/renderShared'

const appRoot = fileURLToPath(new URL('../../', import.meta.url))
const layerRoot = join(appRoot, '../../packages/ui')

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : Object.entries(flatten(value, `${prefix}${key}.`))))
}

/** The real texts of a language: the app's namespaces and the layer's, so a test reads what a person reads. */
export function localeMessages(lang: 'ar' | 'en'): Record<string, string> {
  const files = [join(appRoot, `i18n/locales/${lang}/app.json`), join(appRoot, `i18n/locales/${lang}/adminAuth.json`), join(layerRoot, `i18n/locales/${lang}/ui.json`)]
  return Object.assign({}, ...files.map(file => flatten(JSON.parse(readFileSync(file, 'utf8')) as Tree)))
}

const field = (tag: string) => defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: [String, Boolean], default: '' } },
  setup(props, { attrs }) {
    return () => h(tag, { ...attrs, ...(tag === 'input' && attrs.type === 'checkbox' ? { checked: props.modelValue === true } : { value: props.modelValue }) })
  },
})

/** Plain-HTML stand-ins for the Nuxt UI form controls the auth pages use. */
export const FORM_STUBS: Record<string, Component> = {
  UButton: defineComponent({
    inheritAttrs: false,
    props: { label: String },
    setup(props, { attrs, slots }) {
      const { loading, ...rest } = attrs
      return () => {
        const tag = attrs.href || attrs.to ? 'a' : 'button'
        return h(tag, { ...rest, 'data-loading': loading ? 'true' : undefined }, [props.label, slots.default?.()])
      }
    },
  }),
  UForm: defineComponent({
    inheritAttrs: false,
    setup(_, { attrs, slots }) { return () => h('form', attrs, slots.default?.()) },
  }),
  UFormField: defineComponent({
    props: { label: String, hint: String, help: String, name: String, required: Boolean },
    setup(props, { slots }) {
      return () => h('div', { 'data-field': props.name }, [
        h('label', props.label), slots.default?.(), props.help ? h('p', props.help) : null, props.hint ? h('p', props.hint) : null,
      ])
    },
  }),
  UInput: field('input'),
  UCheckbox: defineComponent({
    inheritAttrs: false,
    props: { modelValue: Boolean, label: String },
    setup(props, { attrs }) {
      return () => h('label', [h('input', { ...attrs, type: 'checkbox', checked: props.modelValue }), props.label])
    },
  }),
}

export interface RenderSfcOptions extends SharedRenderOptions {
  lang?: 'ar' | 'en'
  /** Other components of the app, by the tag the template uses and the file under app/. */
  components?: Record<string, string>
}

const noop = () => undefined
const unit = (options: RenderSfcOptions): SharedRenderOptions => ({
  ...options,
  messages: { ...localeMessages(options.lang ?? 'ar'), ...options.messages },
  globals: { reactive, definePageMeta: noop, useHead: noop, ...options.globals },
  stubs: { ...FORM_STUBS, ...options.stubs },
})

/** Renders a component or page of the app (path under app/) to HTML with the real layer templates around it. */
export async function renderSfc(file: string, props: Record<string, unknown> = {}, slots: Record<string, () => VNode | VNode[]> = {}, options: RenderSfcOptions = {}): Promise<string> {
  const resolved = unit(options)
  const stubs: Record<string, Component> = {
    ...DEFAULT_STUBS,
    SharedStandalonePage: loadShared('StandalonePage', resolved),
    SharedBrandWordmark: loadShared('BrandWordmark', resolved),
    ...Object.fromEntries(Object.entries(options.components ?? {}).map(([tag, path]) => [tag, loadShared(join(appRoot, 'app', path), resolved)])),
    ...resolved.stubs,
  }
  return renderShared(join(appRoot, 'app', file), props, slots, { ...resolved, stubs })
}
