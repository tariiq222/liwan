import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, inject, provide, type RenderFunction } from 'vue'
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { PASSWORD_MUTATION_GC_TIME } from '../useChangePassword'
import { clearPasswordRefs, passwordErrorField, validatePasswordForm } from '../passwordForm'

const passwordSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../components/account/PasswordForm.vue'), 'utf8')
const UForm = defineComponent({ inheritAttrs: false, setup(_, { slots, attrs }) { return () => h('form', attrs, slots.default?.()) } })
const formFieldContext = Symbol('password-form-field')
const UFormField = defineComponent({
  inheritAttrs: false,
  props: { name: { type: String, default: '' }, error: { type: String, default: undefined } },
  setup(props, { slots, attrs }) {
    const ariaId = `test-${props.name}`
    provide(formFieldContext, { ariaId, error: () => props.error })
    return () => {
      const error = props.error
      const errorSlot = error ? slots.error?.({ error }) : undefined
      return h('div', attrs, [
        slots.default?.({ error }),
        error ? h('div', { id: `${ariaId}-error` }, errorSlot ?? error) : undefined,
      ])
    }
  },
})
const UInput = defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: String, default: '' } },
  setup(_, { attrs }) {
    const field = inject<{ ariaId: string; error: () => string | undefined } | null>(formFieldContext, null)
    return () => h('input', {
      ...attrs,
      ...(field?.error() ? { 'aria-describedby': `${field.ariaId}-error`, 'aria-invalid': 'true' } : {}),
    })
  },
})
const UAlert = defineComponent({
  inheritAttrs: false,
  props: { title: { type: String, default: '' } },
  setup(props, { attrs }) { return () => h('div', attrs, props.title) },
})
const UButton = defineComponent({
  inheritAttrs: false,
  props: { label: { type: String, default: '' } },
  setup(props, { slots, attrs }) { return () => h('button', attrs, slots.default?.() ?? props.label) },
})

async function renderPasswordForm(overrides: Record<string, unknown>) {
  const template = parse(passwordSource).descriptor.template
  if (!template) throw new Error('missing password form template')
  const compiled = compileTemplate({ source: template.content, filename: 'PasswordForm.vue', id: 'password-form', compilerOptions: { mode: 'function' } })
  const runnableCode = ts.transpileModule(compiled.code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const render = new Function('Vue', runnableCode)(Vue) as RenderFunction
  const app = createSSRApp({ render: () => h(defineComponent({ setup: () => ({
    t: (key: string) => key, current: '', next: '', confirm: '', currentError: null, newError: null, formError: null, success: false, disabled: false, submit: () => {}, ...overrides,
  }), render })) })
  app.component('UForm', UForm)
  app.component('UFormField', UFormField)
  app.component('UInput', UInput)
  app.component('UAlert', UAlert)
  app.component('UButton', UButton)
  return renderToString(app)
}

describe('password form helpers', () => {
  it('reports mismatched confirmation separately from password strength', () => {
    expect(validatePasswordForm('current-password', 'new-password', 'different')).toEqual({
      valid: false,
      mismatch: true,
      weak: false,
    })
  })

  it('checks the effective trimmed password length', () => {
    expect(validatePasswordForm('current-password', ' 1234567 ', ' 1234567 ')).toEqual({
      valid: false,
      mismatch: false,
      weak: true,
    })
    expect(validatePasswordForm('current-password', ' 12345678 ', ' 12345678 ')).toEqual({
      valid: true,
      mismatch: false,
      weak: false,
    })
    expect(validatePasswordForm('', ' 12345678 ', ' 12345678 ')).toEqual({
      valid: false,
      mismatch: false,
      weak: false,
    })
  })

  it('maps only credential errors to their corresponding field', () => {
    expect(passwordErrorField('wrong_password')).toBe('current')
    expect(passwordErrorField('weak_password')).toBe('new')
    expect(passwordErrorField('invalid')).toBeNull()
    expect(passwordErrorField('http_error')).toBeNull()
  })

  it('clears every password ref after settlement or close', () => {
    const fields = {
      current: { value: 'current-password' },
      next: { value: 'new-password' },
      confirm: { value: 'new-password' },
    }

    clearPasswordRefs(fields)

    expect(fields).toEqual({
      current: { value: '' },
      next: { value: '' },
      confirm: { value: '' },
    })
  })

  it('removes credential variables from the mutation cache after success and failure', async () => {
    async function run(mutationFn: (payload: { current: string; new: string }) => Promise<unknown>) {
      const queryClient = new QueryClient()
      let reset = () => {}
      const observer = new MutationObserver(queryClient, {
        gcTime: PASSWORD_MUTATION_GC_TIME,
        mutationFn,
        onSettled: () => reset(),
      })
      reset = observer.reset
      const unsubscribe = observer.subscribe(() => {})

      await observer.mutate({ current: 'current-secret', new: 'new-secret' }).catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0)

      unsubscribe()
      queryClient.clear()
    }

    await run(async () => ({ ok: true }))
    await run(async () => {
      throw new Error('request failed')
    })
  })

  it('associates and announces field-specific password errors', async () => {
    const html = await renderPasswordForm({ currentError: 'current required', newError: 'too short', formError: 'password mismatch' })
    expect(html).toContain('aria-describedby="test-pw-current-error"')
    expect(html).toContain('id="test-pw-current-error"')
    expect(html).toContain('aria-describedby="test-pw-new-error"')
    expect(html).toContain('id="test-pw-new-error"')
    expect(html).toContain('aria-describedby="test-pw-confirm-error"')
    expect(html).toContain('id="test-pw-confirm-error"')
    expect(html.match(/role="alert"/g)).toHaveLength(3)
  })
})
