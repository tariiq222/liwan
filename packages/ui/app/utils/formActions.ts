import type { InjectionKey, Ref } from 'vue'

/** The creation panel owns the footer surface; forms own their actions and submission. */
export const FORM_ACTIONS_HOST: InjectionKey<{
  target: Ref<HTMLElement | null>
  active: Ref<number>
}> = Symbol('webvue-form-actions')
