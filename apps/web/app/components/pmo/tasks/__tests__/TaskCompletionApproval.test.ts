import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import type { TaskDetail } from '@nasq/contracts'
import ts from 'typescript'
import * as Vue from 'vue'
import { computed, createSSRApp, defineComponent, h, ref, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../TaskCompletionApproval.vue')
const source = readFileSync(filename, 'utf8')
const useTasksSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../composables/useTasks.ts'), 'utf8')

const Passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', attrs, slots.default?.())
  },
})

function loadApproval() {
  const parsed = parse(source, { filename })
  if (!parsed.descriptor.template) throw new Error('no template')
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename,
    id: 'task-completion',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  const runnableCode = ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const render = new Function('Vue', runnableCode)(Vue) as RenderFunction
  return defineComponent({
    props: { task: { type: Object, required: true } },
    setup(props) {
      const task = computed(() => props.task as TaskDetail)
      const t = (key: string) => key
      const hydrated = true
      const busy = false
      const note = ref('')
      const canRequest = computed(() => task.value.allowed_actions.includes('request_completion'))
      const canAccept = computed(() => task.value.allowed_actions.includes('accept_completion'))
      const canReturn = computed(() => task.value.allowed_actions.includes('return_completion'))
      const canWithdraw = computed(() => task.value.allowed_actions.includes('withdraw_completion'))
      const blockedReason = computed(() => task.value.completion_blocked_reason)
      const showSection = computed(() => {
        if (!task.value.completion_policy || task.value.completion_policy === 'none') return false
        if (!task.value.is_closed) return true
        return Boolean(task.value.completion_pending || blockedReason.value || canWithdraw.value)
      })
      const showHint = computed(() => (
        !task.value.is_closed
        && !task.value.completion_pending
        && !blockedReason.value
        && !task.value.completion_return_note
      ))
      return {
        task, t, hydrated, busy, note, canRequest, canAccept, canReturn, canWithdraw,
        blockedReason, showSection, showHint, request: () => {}, accept: () => {},
        returnTask: () => {}, withdraw: () => {},
      }
    },
    render,
  })
}

const base: TaskDetail = {
  id: 1, name: 'Task', project: { id: 4, name: 'Project' }, state: 'in_progress', priority: '0',
  date_deadline: null, days_remaining: null, is_overdue: false, is_closed: false, personal_stage: null,
  stage: null, assignees: [], tags: [], planned_start: null, deliverables: [], description_html: '', allocated_hours: 0, age_days: 0,
  cycle_days: null, subtasks: [], depends_on: [], attachments: [], can_write: true, can_approve: false,
  created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z', milestone: null,
  allowed_transitions: ['waiting', 'cancelled'], allowed_actions: ['read', 'write'],
  completion_pending: false, completion_revision: 1, completion_return_note: null,
  completion_policy: 'project_manager', completion_approver: { id: 4, name: 'Manager' },
  completion_blocked_reason: null, can_manage_dependencies: false,
}

async function renderApproval(task: TaskDetail) {
  const app = createSSRApp({ render: () => h(loadApproval(), { task }) })
  app.component('UButton', Passthrough)
  return renderToString(app)
}

describe('TaskCompletionApproval production template', () => {

  it('shows blocked reason while pending and offers withdraw without guessing roles', async () => {
    const html = await renderApproval({
      ...base,
      completion_pending: true,
      completion_blocked_reason: 'reviewer_ineligible',
      allowed_actions: ['read', 'write', 'withdraw_completion'],
    })
    expect(html).toContain('data-testid="task-completion-blocked"')
    expect(html).toContain('tasks.completion.reviewerIneligible')
    expect(html).toContain('tasks.completion.contactManager')
    expect(html).toContain('data-testid="task-completion-withdraw"')
    expect(html).not.toContain('data-testid="task-completion-accept"')
    expect(html).not.toContain('data-testid="task-completion-request"')
  })

  it('renders accept and return from separate allowed actions', async () => {
    const html = await renderApproval({
      ...base,
      completion_pending: true,
      allowed_actions: ['read', 'accept_completion', 'return_completion'],
    })
    expect(html).toContain('data-testid="task-completion-accept"')
    expect(html).toContain('data-testid="task-completion-return"')
    expect(html).toContain('data-testid="task-completion-note"')
  })

  it('does not show the request hint on a closed task', async () => {
    const html = await renderApproval({
      ...base,
      state: 'done',
      is_closed: true,
      completion_policy: 'project_manager',
      allowed_actions: ['read'],
    })
    expect(html).not.toContain('tasks.completion.hint')
  })
})
