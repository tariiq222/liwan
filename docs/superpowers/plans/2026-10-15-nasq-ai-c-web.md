# Nasq AI — الخطة ج: خادم Nuxt المنفّذ، صفحة `/ai`، مسودة المشروع، النشر

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** الموظف يفتح `/ai`، يسأل فيرى الجواب يُبث مع بطاقات سجلات، ويطلب مشروعًا فتُفتح
صفحة الإنشاء الحقيقية معبّأة ويرسلها بنفسه بإقرار، وكل شيء يُنفَّذ بكوكيه وتُسجَّل آثاره.

**Architecture:** خادم Nuxt هو منفّذ الأدوات: يجلب كتالوج المستخدم من أودو، يبدأ تشغيلًا
في خدمة Nasq AI، وعند `tool_request` من نوع `read` ينفّذ المسار في أودو بكوكي الطلب
الوارد، يرشّح النتيجة، يسجّل التدقيق، ويستأنف في نفس اتصال SSE. `write_light` و`draft`
تُمرَّر للواجهة وتعود عبر `resume`. تطبيق ويب جديد `ai` بمانيفست وصفحة ومكوّنات من
Storybook. مسودة المشروع تمر في `sessionStorage` إلى `ProjectCharterForm` مع إقرار إلزامي.

**Tech Stack:** Nuxt 4 / Nitro / h3 1.15 (`createEventStream`)، Vue 3، Nuxt UI، zod
(`@nasq/contracts`)، vitest، Playwright على المكدس الوهمي، Storybook، docker compose، Woodpecker.

**Spec:** [`../specs/2026-10-15-nasq-ai-design.md`](../specs/2026-10-15-nasq-ai-design.md) —
العقود في [`2026-10-15-nasq-ai-master.md`](2026-10-15-nasq-ai-master.md) (ع1–ع6). تعتمد
على اكتمال الخطتين أ وب.

## Global Constraints

- كما في الخطة الرئيسية، إضافةً إلى: R3 في الويب: `pages/ai` و`components/ai` و`modules/ai`
  لا تستورد من مجلد تطبيق آخر (`components/pmo/...` ممنوع). الربط بصفحة المشروع يكون
  بالتنقل إلى مسار `/projects/new` فقط، والتعديل داخل `components/pmo` تملكه PMO.
- كل نص ظاهر عبر `t()`: مساحة `ai` في `i18n/locales/{ar,en}/ai.json`، ومفاتيح `nav.ai`
  في `common.json`. العربية أولًا، لا نص عربي مضمّن في `.vue`.
- مكوّنات `components/ai/*` لها قصص في `stories/ai/` قبل استخدامها في الصفحة.
- خادم Nuxt لا يخزّن الكوكي ولا أي حالة بين الطلبات؛ كل تنفيذ داخل طلب يحمل الكوكي.
- خادم Nuxt لا ينفّذ إلا أداة موجودة في الكتالوج الذي جلبه **في هذا الطلب نفسه**.
- أوامر الفحص من الـ worktree: `npm test` (vitest للويب والعقود)،
  `npm -w apps/web run lint`، والمكدس الوهمي للـ Playwright كما في `docs/testing.md`.

## Review Focus

1. **طلب تنفيذ لأداة خارج كتالوج الطلب** (الخدمة أخطأت أو تم التلاعب بها): خادم Nuxt يرد
   للخدمة بنتيجة `{ok:false, error:{code:'unknown_tool'}}` ولا ينادي أودو (اختبار المهمة 3).
2. **أودو يرد 403 على أداة قراءة**: `tool_result` بـ `ok:false`، التدقيق `denied`، والبث
   يستمر إلى جواب النموذج (اختبار المهمة 3).
3. **حمولة مسودة فيها مفاتيح مجهولة أو `name` فارغ**: الصفحة تتجاهل المجهول، الحقل يبقى
   فارغًا، وزر الإرسال معطل حتى يُكتب اسم (اختبار المهمة 6).
4. **تحديث الصفحة أثناء `waiting_user`**: `/ai?run=<id>` يعيد الرسائل وبطاقة التأكيد
   المعلّقة من `GET /api/ai/runs/:id` (اختبار المهمة 7).
5. **بلوغ حد الرسائل**: `POST /api/ai/runs` يرد 403 بالرمز نفسه، والصفحة تعرض حالة الحدود
   لا خطأً عامًا (اختبار المهمة 3 و5).

---

### Task 1: عقود zod لـ Nasq AI وإعداد التشغيل

**Files:**
- Create: `packages/contracts/src/ai/index.ts`
- Create: `packages/contracts/src/ai/__tests__/ai.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/web/nuxt.config.ts` (`runtimeConfig.aiServiceUrl`, `runtimeConfig.public.aiEnabled`)

**Interfaces:**
- Produces: `AiToolSchema`, `AiToolsResponseSchema`, `AiAuditRequestSchema`,
  `AiAuditReceiptSchema`, `AiRunStatusSchema`, `AiEventSchema` (اتحاد مميز بـ `event`)،
  `AiDraftPayloadSchema`، والأنواع المشتقة بـ `z.infer`.

- [ ] **Step 1: اكتب الاختبار الفاشل**

`packages/contracts/src/ai/__tests__/ai.test.ts`:

```ts
import { AiAuditRequestSchema, AiDraftPayloadSchema, AiEventSchema, AiToolsResponseSchema } from '../index'

const READ = {
  name: 'pmo.list_my_tasks', kind: 'read', description: { ar: 'مهامي', en: 'My tasks' },
  input_schema: { type: 'object', properties: {} }, route: { method: 'GET', path: '/api/v1/tasks' },
  input_map: { query: { filter: 'mine' } }, result_summary: ['items[].id'], draft_target: null,
}

describe('Nasq AI contracts', () => {
  it('parses the tools response with limits', () => {
    const parsed = AiToolsResponseSchema.parse({ items: [READ], total: 1, limits: { tool_calls_per_run: 8, messages_monthly: null, messages_used: 2 } })
    expect(parsed.items[0]!.route?.method).toBe('GET')
    expect(parsed.limits.messages_monthly).toBeNull()
  })

  it('rejects a draft tool with a route and an unknown kind', () => {
    expect(() => AiToolsResponseSchema.parse({ items: [{ ...READ, kind: 'draft' }], total: 1, limits: { tool_calls_per_run: null, messages_monthly: null, messages_used: 0 } })).toThrow()
    expect(() => AiToolsResponseSchema.parse({ items: [{ ...READ, kind: 'delete' }], total: 1, limits: { tool_calls_per_run: null, messages_monthly: null, messages_used: 0 } })).toThrow()
  })

  it('types every SSE event by name', () => {
    expect(AiEventSchema.parse({ event: 'token', data: { text: 'م' } }).event).toBe('token')
    const request = AiEventSchema.parse({ event: 'tool_request', data: { call_id: 'c_1', tool: 'pmo.list_my_tasks', kind: 'read', input: {}, summary_ar: 'سأقرأ', summary_en: 'I will read' } })
    expect(request.event === 'tool_request' && request.data.kind).toBe('read')
    expect(() => AiEventSchema.parse({ event: 'explode', data: {} })).toThrow()
  })

  it('requires attestation to approve a draft and strips nothing silently', () => {
    expect(() => AiAuditRequestSchema.parse({ conversation_id: 'r_1', kind: 'draft', tool_name: 'pmo.draft_project', input: {}, result: 'approved', http_status: null, draft: {}, approved: {}, attested: false })).toThrow()
    expect(AiAuditRequestSchema.parse({ conversation_id: 'r_1', kind: 'message', tool_name: null, input: null, result: 'ok', http_status: null, draft: null, approved: null, attested: false }).kind).toBe('message')
  })

  it('keeps only known draft keys and needs a name', () => {
    expect(() => AiDraftPayloadSchema.parse({ name: '' })).toThrow()
    const parsed = AiDraftPayloadSchema.parse({ name: 'بوابة', charter: { objectives: ['أ'], bogus: 1 }, bogus: 2 })
    expect(parsed).toEqual({ name: 'بوابة', charter: { objectives: ['أ'] } })
  })
})
```

- [ ] **Step 2: شغّل للتأكد من الفشل**

Run: `npm test -- packages/contracts/src/ai`
Expected: FAIL (`Cannot find module '../index'`).

- [ ] **Step 3: اكتب العقود وأضفها للفهرس وإعداد التشغيل**

`packages/contracts/src/ai/index.ts`:

```ts
import { z } from 'zod'

export const AiToolKindSchema = z.enum(['read', 'write_light', 'draft'])
export const AiRouteSchema = z.object({ method: z.enum(['GET', 'POST', 'PATCH']), path: z.string().startsWith('/api/v1/') }).strict()

export const AiToolSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  kind: AiToolKindSchema,
  description: z.object({ ar: z.string().min(1), en: z.string().min(1) }).strict(),
  input_schema: z.record(z.string(), z.unknown()),
  route: AiRouteSchema.nullable(),
  input_map: z.record(z.enum(['path', 'query', 'body']), z.record(z.string(), z.unknown())),
  result_summary: z.array(z.string()),
  draft_target: z.string().startsWith('/').nullable(),
}).strict().refine(tool => (tool.kind === 'draft') === (tool.route === null && tool.draft_target !== null), {
  message: 'a draft tool has a draft_target and no route; other tools have a route',
})
export type AiTool = z.infer<typeof AiToolSchema>

export const AiLimitsSchema = z.object({
  tool_calls_per_run: z.number().int().nonnegative().nullable(),
  messages_monthly: z.number().int().nonnegative().nullable(),
  messages_used: z.number().int().nonnegative(),
}).strict()

export const AiToolsResponseSchema = z.object({ items: z.array(AiToolSchema), total: z.number().int().nonnegative(), limits: AiLimitsSchema }).strict()
export type AiToolsResponse = z.infer<typeof AiToolsResponseSchema>

export const AiAuditKindSchema = z.enum(['message', 'read', 'write_light', 'draft'])
export const AiAuditResultSchema = z.enum(['ok', 'denied', 'failed', 'proposed', 'approved', 'rejected'])
export const AiAuditRequestSchema = z.object({
  conversation_id: z.string().min(1).max(64),
  kind: AiAuditKindSchema,
  tool_name: z.string().nullable(),
  input: z.record(z.string(), z.unknown()).nullable(),
  result: AiAuditResultSchema,
  http_status: z.number().int().min(100).max(599).nullable(),
  draft: z.record(z.string(), z.unknown()).nullable(),
  approved: z.record(z.string(), z.unknown()).nullable(),
  attested: z.boolean(),
}).strict().refine(body => body.result !== 'approved' || body.attested, { message: 'an approved draft needs attestation', path: ['attested'] })
export type AiAuditRequest = z.infer<typeof AiAuditRequestSchema>
export const AiAuditReceiptSchema = z.object({ id: z.number().int().positive(), messages_used: z.number().int().nonnegative(), messages_limit: z.number().int().nonnegative().nullable() }).strict()

export const AiRecordRefSchema = z.object({ type: z.string(), id: z.number().int(), label: z.string() }).strict()
export const AiToolRequestSchema = z.object({
  call_id: z.string(), tool: z.string(), kind: AiToolKindSchema, input: z.record(z.string(), z.unknown()),
  summary_ar: z.string(), summary_en: z.string(),
}).strict()
export const AiRunStatusValueSchema = z.enum(['running', 'waiting_tool', 'waiting_user', 'done', 'failed', 'limit_reached'])
export const AiEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('run'), data: z.object({ run_id: z.string() }).strict() }),
  z.object({ event: z.literal('token'), data: z.object({ text: z.string() }).strict() }),
  z.object({ event: z.literal('tool_request'), data: AiToolRequestSchema }),
  z.object({ event: z.literal('tool_result'), data: z.object({ call_id: z.string(), tool: z.string(), kind: AiToolKindSchema, ok: z.boolean(), summary_ar: z.string(), summary_en: z.string() }).strict() }),
  z.object({ event: z.literal('answer'), data: z.object({ text: z.string(), records: z.array(AiRecordRefSchema) }).strict() }),
  z.object({ event: z.literal('limit_reached'), data: z.object({ limit: z.enum(['max_tool_calls', 'max_steps', 'timeout', 'messages_monthly']) }).strict() }),
  z.object({ event: z.literal('error'), data: z.object({ code: z.string(), message: z.string() }).strict() }),
  z.object({ event: z.literal('done'), data: z.object({ status: AiRunStatusValueSchema }).strict() }),
])
export type AiEvent = z.infer<typeof AiEventSchema>

export const AiRunStatusSchema = z.object({
  run_id: z.string(),
  status: AiRunStatusValueSchema,
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }).strict()),
  pending: z.object({ call_id: z.string(), tool: z.string(), kind: AiToolKindSchema, input: z.record(z.string(), z.unknown()) }).strict().nullable(),
}).strict()
export type AiRunStatus = z.infer<typeof AiRunStatusSchema>

const Text = z.string().max(4000)
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
// Contract ع5: unknown keys are dropped (strip), the name is required.
export const AiDraftPayloadSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: Text.optional(),
  date_start: Day.optional(),
  date_end: Day.optional(),
  charter: z.object({
    rationale: Text.optional(),
    objectives: z.array(z.string().max(500)).max(10).optional(),
    scope: Text.optional(), exclusions: Text.optional(), success: Text.optional(),
    assumptions: Text.optional(), constraints: Text.optional(),
  }).optional(),
})
export type AiDraftPayload = z.infer<typeof AiDraftPayloadSchema>

/** What `/ai` stores for `/projects/new?aiDraft=<id>` (sessionStorage key `nasq:ai-draft:<id>`). */
export const AiDraftHandoffSchema = z.object({
  run_id: z.string(), call_id: z.string(), tool: z.string(), payload: AiDraftPayloadSchema,
}).strict()
export type AiDraftHandoff = z.infer<typeof AiDraftHandoffSchema>
```

في `packages/contracts/src/index.ts` أضف السطر `export * from './ai'` بعد `./operations`.

في `apps/web/nuxt.config.ts` داخل `runtimeConfig` بعد `authProxyClientIpHeader: '',`:

```ts
    // Nasq AI service (apps/ai-service). Empty hides /ai and disables the executor.
    aiServiceUrl: process.env.NUXT_AI_SERVICE_URL ?? '',
```

وداخل `runtimeConfig.public` أضف:

```ts
      aiEnabled: Boolean(process.env.NUXT_AI_SERVICE_URL),
```

- [ ] **Step 4: شغّل الاختبارات**

Run: `npm test -- packages/contracts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/web/nuxt.config.ts
git commit -m "feat(web): add the Nasq AI contracts and service runtime config"
```

---

### Task 2: منفّذ الأدوات في خادم Nuxt (نقي، قابل للاختبار)

**Files:**
- Create: `apps/web/server/utils/ai/executor.ts`
- Create: `apps/web/server/utils/ai/__tests__/executor.test.ts`

**Interfaces:**
- Produces (دوال نقية بلا h3):
  - `buildToolRequest(tool: AiTool, input): { method, path, query, body }` يطبّق `input_map`
    و`{placeholder}`.
  - `summarizeResult(data: unknown, paths: string[]): unknown` يطبّق `result_summary`.
  - `toolResultFromUpstream(status: number, body: unknown, tool: AiTool): ToolResult` بشكل ع2.

- [ ] **Step 1: اكتب الاختبار الفاشل**

`apps/web/server/utils/ai/__tests__/executor.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AiTool } from '@nasq/contracts'
import { buildToolRequest, summarizeResult, toolResultFromUpstream } from '../executor'

const list: AiTool = {
  name: 'pmo.list_my_tasks', kind: 'read', description: { ar: 'م', en: 'm' }, input_schema: { type: 'object' },
  route: { method: 'GET', path: '/api/v1/tasks' }, input_map: { query: { filter: 'mine', state: '$state', limit: '$limit' } },
  result_summary: ['items[].id', 'items[].name', 'items[].project.name', 'total'], draft_target: null,
}
const transition: AiTool = {
  ...list, name: 'pmo.update_task_state', kind: 'write_light', route: { method: 'POST', path: '/api/v1/tasks/{task_id}/transition' },
  input_map: { path: { task_id: '$task_id' }, body: { state: '$state' } }, result_summary: ['id', 'state'],
}

describe('buildToolRequest', () => {
  it('maps inputs onto query, drops missing ones and keeps constants', () => {
    expect(buildToolRequest(list, { limit: 5 })).toEqual({ method: 'GET', path: '/api/v1/tasks', query: { filter: 'mine', limit: 5 }, body: undefined })
  })
  it('fills path placeholders and the body', () => {
    expect(buildToolRequest(transition, { task_id: 7, state: 'done' })).toEqual({ method: 'POST', path: '/api/v1/tasks/7/transition', query: {}, body: { state: 'done' } })
  })
  it('refuses an unfilled placeholder', () => {
    expect(() => buildToolRequest(transition, { state: 'done' })).toThrow(/task_id/)
  })
  it('encodes path values so a value cannot escape the segment', () => {
    expect(buildToolRequest(transition, { task_id: '7/../8', state: 'done' }).path).toBe('/api/v1/tasks/7%2F..%2F8/transition')
  })
})

describe('summarizeResult', () => {
  it('keeps only whitelisted paths, including nested arrays', () => {
    const data = { items: [{ id: 1, name: 'أ', secret: 'x', project: { id: 9, name: 'ب', budget: 3 } }], total: 1, extra: true }
    expect(summarizeResult(data, list.result_summary)).toEqual({ items: [{ id: 1, name: 'أ', project: { name: 'ب' } }], total: 1 })
  })
  it('returns an empty object when nothing matches', () => {
    expect(summarizeResult({ a: 1 }, ['b'])).toEqual({})
  })
})

describe('toolResultFromUpstream', () => {
  it('wraps 2xx as ok with the summarized data', () => {
    expect(toolResultFromUpstream(200, { items: [{ id: 1, name: 'أ', secret: 1 }], total: 1 }, list)).toEqual({ ok: true, data: { items: [{ id: 1, name: 'أ' }], total: 1 } })
  })
  it('wraps a structured error as a tool error', () => {
    expect(toolResultFromUpstream(403, { error: { code: 'forbidden', message: 'no' } }, list)).toEqual({ ok: false, error: { code: 'forbidden', message: 'no' } })
  })
  it('wraps an unknown failure as http_error', () => {
    expect(toolResultFromUpstream(502, 'bad gateway', list)).toEqual({ ok: false, error: { code: 'http_error', message: 'upstream status 502' } })
  })
})
```

- [ ] **Step 2: شغّل للتأكد من الفشل**

Run: `npm -w apps/web test -- server/utils/ai`
Expected: FAIL (`Cannot find module '../executor'`).

- [ ] **Step 3: اكتب المنفّذ النقي**

`apps/web/server/utils/ai/executor.ts`:

```ts
import type { AiTool } from '@nasq/contracts'

export type ToolRequest = { method: 'GET' | 'POST' | 'PATCH'; path: string; query: Record<string, unknown>; body: Record<string, unknown> | undefined }
export type ToolError = { code: string; message: string }
export type ToolResult = { ok: true; data: unknown } | { ok: false; error: ToolError }

function resolve(values: Record<string, unknown>, input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && value.startsWith('$')) {
      const supplied = input[value.slice(1)]
      if (supplied !== undefined && supplied !== null) out[key] = supplied
    } else {
      out[key] = value
    }
  }
  return out
}

/** Contract ع1 `input_map`: `$name` reads the input, constants stay, path values are URL-encoded. */
export function buildToolRequest(tool: AiTool, input: Record<string, unknown>): ToolRequest {
  if (!tool.route) throw new Error(`${tool.name} has no route`)
  const pathValues = resolve(tool.input_map.path ?? {}, input)
  const path = tool.route.path.replace(/\{([a-z_][a-z0-9_]*)\}/g, (_, name: string) => {
    const value = pathValues[name]
    if (value === undefined) throw new Error(`missing path value ${name}`)
    return encodeURIComponent(String(value))
  })
  const body = tool.input_map.body ? resolve(tool.input_map.body, input) : undefined
  return { method: tool.route.method, path, query: resolve(tool.input_map.query ?? {}, input), body }
}

type Node = Record<string, unknown>

function pick(source: unknown, segments: string[], target: Node): void {
  if (segments.length === 0 || source === null || typeof source !== 'object') return
  const [head, ...rest] = segments
  const isArray = head!.endsWith('[]')
  const key = isArray ? head!.slice(0, -2) : head!
  const value = (source as Node)[key]
  if (value === undefined) return
  if (isArray) {
    if (!Array.isArray(value)) return
    const rows = (target[key] as Node[] | undefined) ?? value.map(() => ({}))
    target[key] = rows
    value.forEach((row, index) => {
      if (rest.length === 0) rows[index] = row as Node
      else pick(row, rest, rows[index]!)
    })
    return
  }
  if (rest.length === 0) {
    target[key] = value
    return
  }
  const child = (target[key] as Node | undefined) ?? {}
  target[key] = child
  pick(value, rest, child)
}

/** Contract ع1 `result_summary`: a whitelist of dotted paths; `[]` means every element. */
export function summarizeResult(data: unknown, paths: string[]): unknown {
  const target: Node = {}
  for (const path of paths) pick(data, path.split('.'), target)
  return target
}

export function toolResultFromUpstream(status: number, body: unknown, tool: AiTool): ToolResult {
  if (status >= 200 && status < 300) return { ok: true, data: summarizeResult(body, tool.result_summary) }
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error
  if (error && typeof error.code === 'string') return { ok: false, error: { code: error.code, message: typeof error.message === 'string' ? error.message : '' } }
  return { ok: false, error: { code: 'http_error', message: `upstream status ${status}` } }
}
```

- [ ] **Step 4: شغّل الاختبارات**

Run: `npm -w apps/web test -- server/utils/ai`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/utils/ai
git commit -m "feat(web): add the Nasq AI tool executor helpers"
```

---

### Task 3: مسارات خادم Nuxt: بدء التشغيل، الاستئناف، الحالة

**Files:**
- Create: `apps/web/server/utils/ai/upstream.ts`
- Create: `apps/web/server/utils/ai/session.ts`
- Create: `apps/web/server/api/ai/runs/index.post.ts`
- Create: `apps/web/server/api/ai/runs/[id]/resume.post.ts`
- Create: `apps/web/server/api/ai/runs/[id]/index.get.ts`
- Create: `apps/web/server/utils/ai/__tests__/runs.wire.test.ts`

**Interfaces:**
- Consumes: ع1–ع4؛ `tenantUpstreamHeaders(event)`, `tenantTransport(...)`, `assertSameSiteJson(event)`؛
  `useRuntimeConfig(event).odooUrl / aiServiceUrl`؛ h3 `createEventStream`.
- Produces:
  - `odooJson(event, method, path, {query, body}) -> {status, body}` ينادي أودو بكوكي الطلب
    (وترويسات المستأجر في الوضع المشترك).
  - `serviceSse(event, method, path, body, owner) -> Response` ينادي الخدمة بالترويستين.
  - `runSession(event) -> {tools: AiTool[], limits, me: {id, company}}` يجلب `/api/v1/me` و`/api/v1/ai/tools`.
  - `pumpRun(...)` حلقة البث والتنفيذ الموصوفة في المواصفة 3.3.
  - المسارات الثلاثة حسب ع3.

- [ ] **Step 1: اكتب اختبار السلك الفاشل**

`apps/web/server/utils/ai/__tests__/runs.wire.test.ts` (نفس أسلوب `authProxyIdentity.test.ts`:
خادم أودو وهمي وخادم خدمة وهمي حقيقيان على منافذ عشوائية، وتطبيق h3 حقيقي):

```ts
import http from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendResponseHeader, createApp, createError, createEventStream, defineEventHandler, getHeader, getQuery, getRequestHeader, getRouterParam, readBody, setResponseHeader, toNodeListener } from 'h3'

let odoo: http.Server, service: http.Server, app: http.Server
let odooUrl: string, serviceUrl: string, url: string
let odooCalls: { method: string; url: string; cookie?: string; body?: string }[] = []
let serviceCalls: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = []
let scenario: 'read' | 'draft' | 'limit' | 'unknown' = 'read'
let odooToolsStatus = 200

const TOOLS = {
  items: [
    { name: 'pmo.list_my_tasks', kind: 'read', description: { ar: 'م', en: 'm' }, input_schema: { type: 'object' }, route: { method: 'GET', path: '/api/v1/tasks' }, input_map: { query: { filter: 'mine' } }, result_summary: ['items[].id', 'items[].name', 'total'], draft_target: null },
    { name: 'pmo.draft_project', kind: 'draft', description: { ar: 'م', en: 'm' }, input_schema: { type: 'object' }, route: null, input_map: {}, result_summary: [], draft_target: '/projects/new' },
  ],
  total: 2,
  limits: { tool_calls_per_run: 8, messages_monthly: 100, messages_used: 1 },
}
const ME = { id: 42, name: 'سارة', company: { id: 1, name: 'نسق' } }

function sse(res: http.ServerResponse, events: [string, unknown][]) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const [name, data] of events) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  res.end()
}

beforeAll(async () => {
  for (const [name, value] of Object.entries({ appendResponseHeader, createError, createEventStream, defineEventHandler, getHeader, getQuery, getRequestHeader, getRouterParam, readBody, setResponseHeader })) vi.stubGlobal(name, value)
  odoo = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    odooCalls.push({ method: req.method!, url: req.url!, cookie: req.headers.cookie, body })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/v1/me') return res.end(JSON.stringify(ME))
    if (req.url === '/api/v1/ai/tools') { res.statusCode = odooToolsStatus; return res.end(JSON.stringify(odooToolsStatus === 200 ? TOOLS : { error: { code: 'feature_not_included', message: 'limit', details: { reason: 'limit', limit_key: 'ai.messages.monthly' } } })) }
    if (req.url === '/api/v1/ai/audit') { odooToolsStatus === 200 ? res.end(JSON.stringify({ id: 1, messages_used: 2, messages_limit: 100 })) : (res.statusCode = 403, res.end(JSON.stringify({ error: { code: 'feature_not_included', message: 'limit', details: { reason: 'limit', limit_key: 'ai.messages.monthly' } } }))); return }
    if (req.url?.startsWith('/api/v1/tasks')) {
      if (req.headers.cookie !== 'session_id=s1') { res.statusCode = 403; return res.end(JSON.stringify({ error: { code: 'forbidden', message: 'no' } })) }
      return res.end(JSON.stringify({ items: [{ id: 5, name: 'تقرير', secret: 'x' }], total: 1 }))
    }
    res.statusCode = 404; res.end('{}')
  })
  service = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    serviceCalls.push({ method: req.method!, url: req.url!, headers: req.headers, body })
    if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ run_id: 'r_1', status: 'waiting_user', messages: [{ role: 'user', content: 'هلا' }], pending: { call_id: 'c_2', tool: 'pmo.draft_project', kind: 'draft', input: { name: 'بوابة' } } })) }
    if (req.url === '/v1/runs') {
      if (scenario === 'read') return sse(res, [['run', { run_id: 'r_1' }], ['tool_request', { call_id: 'c_1', tool: 'pmo.list_my_tasks', kind: 'read', input: {}, summary_ar: 'سأقرأ', summary_en: 'read' }], ['done', { status: 'waiting_tool' }]])
      if (scenario === 'unknown') return sse(res, [['run', { run_id: 'r_1' }], ['tool_request', { call_id: 'c_9', tool: 'pmo.delete_all', kind: 'read', input: {}, summary_ar: 'س', summary_en: 's' }], ['done', { status: 'waiting_tool' }]])
      return sse(res, [['run', { run_id: 'r_1' }], ['tool_request', { call_id: 'c_2', tool: 'pmo.draft_project', kind: 'draft', input: { name: 'بوابة' }, summary_ar: 'س', summary_en: 's' }], ['done', { status: 'waiting_user' }]])
    }
    return sse(res, [['run', { run_id: 'r_1' }], ['token', { text: 'عندك' }], ['answer', { text: 'عندك مهمة', records: [{ type: 'task', id: 5, label: 'تقرير' }] }], ['done', { status: 'done' }]])
  })
  await new Promise<void>(r => odoo.listen(0, '127.0.0.1', r))
  await new Promise<void>(r => service.listen(0, '127.0.0.1', r))
  odooUrl = `http://127.0.0.1:${(odoo.address() as any).port}`
  serviceUrl = `http://127.0.0.1:${(service.address() as any).port}`
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl, aiServiceUrl: serviceUrl, odooDb: 'x', authProxyClientIpHeader: '' }))
  const { assertSameSiteJson } = await import('../../same-site')
  vi.stubGlobal('assertSameSiteJson', assertSameSiteJson)
  const start = (await import('../../../api/ai/runs/index.post')).default
  const resume = (await import('../../../api/ai/runs/[id]/resume.post')).default
  const status = (await import('../../../api/ai/runs/[id]/index.get')).default
  const h3app = createApp()
  h3app.use('/api/ai/runs', defineEventHandler((event) => {
    const match = event.path.match(/^\/api\/ai\/runs\/([^/?]+)(\/resume)?/)
    if (!match) return start(event)
    event.context.params = { id: match[1]! }
    return match[2] ? resume(event) : status(event)
  }))
  app = http.createServer(toNodeListener(h3app))
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(app.address() as any).port}`
})
afterAll(() => { odoo.close(); service.close(); app.close() })
beforeEach(() => { odooCalls = []; serviceCalls = []; scenario = 'read'; odooToolsStatus = 200 })

const post = (path: string, body: unknown, cookie = 'session_id=s1') => fetch(`${url}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie, origin: url, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body),
})
const events = async (response: Response) => (await response.text()).trim().split('\n\n').map((block) => {
  const name = block.match(/^event: (.+)$/m)![1]!
  return [name, JSON.parse(block.match(/^data: (.+)$/m)![1]!)] as [string, any]
})

describe('POST /api/ai/runs', () => {
  it('executes a read tool with the caller cookie, audits it, and resumes in one stream', async () => {
    const list = await events(await post('/api/ai/runs', { message: 'هلا' }))
    const names = list.map(([n]) => n)
    expect(names).toEqual(['run', 'tool_request', 'tool_result', 'token', 'answer', 'done'])
    expect(list[2]![1]).toMatchObject({ call_id: 'c_1', tool: 'pmo.list_my_tasks', ok: true })
    const tasksCall = odooCalls.find(c => c.url.startsWith('/api/v1/tasks'))!
    expect(tasksCall.cookie).toBe('session_id=s1')
    expect(tasksCall.url).toBe('/api/v1/tasks?filter=mine')
    const resumeCall = serviceCalls.find(c => c.url === '/v1/runs/r_1/resume')!
    expect(resumeCall.headers['x-nasq-tenant']).toBe('x')
    expect(resumeCall.headers['x-nasq-user']).toBe('42')
    expect(JSON.parse(resumeCall.body)).toEqual({ call_id: 'c_1', result: { ok: true, data: { items: [{ id: 5, name: 'تقرير' }], total: 1 } } })
    const audits = odooCalls.filter(c => c.url === '/api/v1/ai/audit').map(c => JSON.parse(c.body!))
    expect(audits.map(a => [a.kind, a.result])).toEqual([['message', 'ok'], ['read', 'ok']])
    const started = JSON.parse(serviceCalls.find(c => c.url === '/v1/runs')!.body)
    expect(started.tools.map((t: any) => t.name)).toEqual(['pmo.list_my_tasks', 'pmo.draft_project'])
    expect(started.limits).toEqual({ max_steps: 12, max_tool_calls: 8, timeout_seconds: 120 })
  })

  it('reports a denied read as a failed tool result and keeps streaming', async () => {
    const list = await events(await post('/api/ai/runs', { message: 'هلا' }, 'session_id=other'))
    expect(list.map(([n]) => n)).toContain('answer')
    const resumeCall = serviceCalls.find(c => c.url === '/v1/runs/r_1/resume')!
    expect(JSON.parse(resumeCall.body).result).toEqual({ ok: false, error: { code: 'forbidden', message: 'no' } })
    const audit = odooCalls.filter(c => c.url === '/api/v1/ai/audit').map(c => JSON.parse(c.body!)).at(-1)
    expect([audit.kind, audit.result, audit.http_status]).toEqual(['read', 'denied', 403])
  })

  it('never calls Odoo for a tool outside the fetched catalog', async () => {
    scenario = 'unknown'
    await events(await post('/api/ai/runs', { message: 'هلا' }))
    expect(odooCalls.some(c => c.url.includes('delete'))).toBe(false)
    expect(JSON.parse(serviceCalls.find(c => c.url === '/v1/runs/r_1/resume')!.body).result).toEqual({ ok: false, error: { code: 'unknown_tool', message: 'pmo.delete_all is not in the catalog' } })
  })

  it('passes a draft request through and stops at waiting_user', async () => {
    scenario = 'draft'
    const list = await events(await post('/api/ai/runs', { message: 'سوّ مشروع' }))
    expect(list.map(([n]) => n)).toEqual(['run', 'tool_request', 'done'])
    expect(list.at(-1)![1]).toEqual({ status: 'waiting_user' })
    const audit = odooCalls.filter(c => c.url === '/api/v1/ai/audit').map(c => JSON.parse(c.body!)).at(-1)
    expect([audit.kind, audit.result, audit.draft]).toEqual(['draft', 'proposed', { name: 'بوابة' }])
    expect(serviceCalls.some(c => c.url.endsWith('/resume'))).toBe(false)
  })

  it('answers 403 with the limit code before contacting the service when the monthly limit is reached', async () => {
    odooToolsStatus = 403
    const response = await post('/api/ai/runs', { message: 'هلا' })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ data: { code: 'feature_not_included', details: { limit_key: 'ai.messages.monthly' } } })
    expect(serviceCalls).toEqual([])
  })

  it('rejects a cross-site post', async () => {
    const response = await fetch(`${url}/api/ai/runs`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'session_id=s1', origin: 'https://evil.example' }, body: '{"message":"x"}' })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(serviceCalls).toEqual([])
  })
})

describe('resume and status', () => {
  it('resumes with the user decision and relays the stream', async () => {
    const list = await events(await post('/api/ai/runs/r_1/resume', { call_id: 'c_2', decision: 'approved', data: { id: 77, name: 'بوابة' } }))
    expect(list.map(([n]) => n)).toEqual(['run', 'token', 'answer', 'done'])
    expect(JSON.parse(serviceCalls.at(-1)!.body)).toEqual({ call_id: 'c_2', result: { ok: true, decision: 'approved', data: { id: 77, name: 'بوابة' } } })
  })
  it('returns the run status with its pending call', async () => {
    const response = await fetch(`${url}/api/ai/runs/r_1`, { headers: { cookie: 'session_id=s1' } })
    expect((await response.json()).pending.tool).toBe('pmo.draft_project')
    expect(serviceCalls.at(-1)!.headers['x-nasq-user']).toBe('42')
  })
})
```

- [ ] **Step 2: شغّل للتأكد من الفشل**

Run: `npm -w apps/web test -- server/utils/ai/__tests__/runs.wire.test.ts`
Expected: FAIL (الوحدات غير موجودة).

- [ ] **Step 3: اكتب الوسائط والمسارات**

`apps/web/server/utils/ai/upstream.ts`:

```ts
import type { H3Event } from 'h3'
import { getHeader } from 'h3'
import { joinURL, withQuery } from 'ufo'
import { tenantTransport } from '../tenantTransport'
import { tenantUpstreamHeaders } from '../tenantRequest'

export type Upstream = { status: number; body: unknown }

/** One Odoo call as the caller: the request cookie travels, nothing else is added. */
export async function odooJson(event: H3Event, method: 'GET' | 'POST' | 'PATCH', path: string, options: { query?: Record<string, unknown>; body?: unknown } = {}): Promise<Upstream> {
  const { odooUrl } = useRuntimeConfig(event)
  const cookie = getHeader(event, 'cookie')
  if (!cookie) throw createError({ statusCode: 401, data: { code: 'unauthorized' } })
  const target = withQuery(path, options.query ?? {})
  const headers: Record<string, string> = { cookie, accept: 'application/json', ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}) }
  const body = options.body !== undefined ? JSON.stringify(options.body) : undefined
  const tenantHeaders = tenantUpstreamHeaders(event)
  const response = Object.keys(tenantHeaders).length
    ? await tenantTransport(event, odooUrl, target, { method, body, headers })
    : await fetch(joinURL(odooUrl, target), { method, body, headers, redirect: 'error', signal: AbortSignal.timeout(15000) })
  const text = await response.text()
  let parsed: unknown = text
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  return { status: response.status, body: parsed }
}

export type Owner = { tenant: string; user: string }

/** One call to the Nasq AI service. The owner headers are the service's only notion of identity. */
export function serviceFetch(event: H3Event, method: 'GET' | 'POST', path: string, owner: Owner, body?: unknown): Promise<Response> {
  const { aiServiceUrl } = useRuntimeConfig(event)
  if (!aiServiceUrl) throw createError({ statusCode: 503, data: { code: 'ai_unavailable' } })
  return fetch(joinURL(aiServiceUrl, path), {
    method,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream, application/json', 'x-nasq-tenant': owner.tenant, 'x-nasq-user': owner.user },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(130000),
  })
}

/** Parse an SSE body into `[event, data]` pairs as they arrive. */
export async function* readSse(response: Response): AsyncGenerator<[string, any]> {
  if (!response.ok || !response.body) throw createError({ statusCode: response.status === 404 ? 404 : 502, data: { code: response.status === 409 ? 'ai_conflict' : 'ai_upstream' } })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index: number
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      const name = block.match(/^event: (.+)$/m)?.[1]
      const data = block.match(/^data: (.+)$/m)?.[1]
      if (name && data) yield [name, JSON.parse(data)]
    }
  }
}
```

`apps/web/server/utils/ai/session.ts`:

```ts
import type { H3Event } from 'h3'
import { AiToolsResponseSchema, type AiTool } from '@nasq/contracts'
import { odooJson, type Owner } from './upstream'

export type RunSession = { owner: Owner; tools: AiTool[]; byName: Map<string, AiTool>; limits: { max_steps: number; max_tool_calls: number; timeout_seconds: number } }

const MAX_STEPS = 12
const DEFAULT_TOOL_CALLS = 8
const TIMEOUT_SECONDS = 120

function forward(upstream: { status: number; body: unknown }): never {
  const error = (upstream.body as { error?: Record<string, unknown> } | null)?.error
  throw createError({ statusCode: upstream.status, data: error ?? { code: 'http_error' } })
}

/** The caller's identity and tool catalog for this request only. Any upstream denial is forwarded as is. */
export async function runSession(event: H3Event): Promise<RunSession> {
  const me = await odooJson(event, 'GET', '/api/v1/me')
  if (me.status !== 200) forward(me)
  const tools = await odooJson(event, 'GET', '/api/v1/ai/tools')
  if (tools.status !== 200) forward(tools)
  const parsed = AiToolsResponseSchema.parse(tools.body)
  const { odooDb } = useRuntimeConfig(event)
  const meBody = me.body as { id: number; company: { id: number } }
  return {
    owner: { tenant: odooDb || `company:${meBody.company.id}`, user: String(meBody.id) },
    tools: parsed.items,
    byName: new Map(parsed.items.map(tool => [tool.name, tool])),
    limits: { max_steps: MAX_STEPS, max_tool_calls: parsed.limits.tool_calls_per_run ?? DEFAULT_TOOL_CALLS, timeout_seconds: TIMEOUT_SECONDS },
  }
}
```

ملاحظة: في الوضع المشترك `odooDb` فارغ، فالمستأجر يُشتق من `tenantRequest(event).database`؛
أضف ذلك عندما يُفعَّل الوضع المشترك للذكاء (المرحلة 2)، وحتى ذلك الحين `company:<id>` كافٍ
لأن كل عميل له قاعدة.

`apps/web/server/api/ai/runs/index.post.ts`:

```ts
import { createEventStream, getHeader } from 'h3'
import type { AiTool } from '@nasq/contracts'
import { buildToolRequest, toolResultFromUpstream, type ToolResult } from '../../../utils/ai/executor'
import { odooJson, readSse, serviceFetch } from '../../../utils/ai/upstream'
import { runSession, type RunSession } from '../../../utils/ai/session'

type StartBody = { message?: string; context?: { page: string; id?: number | null } | null; run_id?: string }

async function audit(event: any, body: Record<string, unknown>) {
  const receipt = await odooJson(event, 'POST', '/api/v1/ai/audit', { body })
  if (receipt.status !== 200) {
    const error = (receipt.body as { error?: Record<string, unknown> } | null)?.error
    throw createError({ statusCode: receipt.status, data: error ?? { code: 'http_error' } })
  }
}

/** Executes one read tool as the caller and returns the service-shaped result. Never throws on upstream errors. */
async function executeRead(event: any, session: RunSession, runId: string, request: { call_id: string; tool: string; input: Record<string, unknown> }): Promise<ToolResult> {
  const tool: AiTool | undefined = session.byName.get(request.tool)
  if (!tool || tool.kind !== 'read') {
    return { ok: false, error: { code: 'unknown_tool', message: `${request.tool} is not in the catalog` } }
  }
  let built
  try { built = buildToolRequest(tool, request.input) } catch (error) {
    return { ok: false, error: { code: 'invalid_arguments', message: (error as Error).message } }
  }
  const upstream = await odooJson(event, built.method, built.path, { query: built.query, body: built.body })
  const result = toolResultFromUpstream(upstream.status, upstream.body, tool)
  await audit(event, {
    conversation_id: runId, kind: 'read', tool_name: tool.name, input: request.input,
    result: result.ok ? 'ok' : upstream.status === 403 ? 'denied' : 'failed', http_status: upstream.status, draft: null, approved: null, attested: false,
  })
  return result
}

/** Relays the service stream to the browser; read tools are executed here and resumed in the same stream. */
export async function pumpRun(event: any, session: RunSession, stream: ReturnType<typeof createEventStream>, response: Response) {
  let runId = ''
  let next: Response | null = response
  while (next) {
    const current = next
    next = null
    for await (const [name, data] of readSse(current)) {
      if (name === 'run') runId = data.run_id
      if (name === 'tool_request' && data.kind === 'read') {
        await stream.push({ event: name, data: JSON.stringify(data) })
        const result = await executeRead(event, session, runId, data)
        await stream.push({ event: 'tool_result', data: JSON.stringify({ call_id: data.call_id, tool: data.tool, kind: data.kind, ok: result.ok, summary_ar: data.summary_ar, summary_en: data.summary_en }) })
        next = await serviceFetch(event, 'POST', `/v1/runs/${runId}/resume`, session.owner, { call_id: data.call_id, result })
        break
      }
      if (name === 'tool_request' && data.kind === 'draft') {
        await audit(event, { conversation_id: runId, kind: 'draft', tool_name: data.tool, input: data.input, result: 'proposed', http_status: null, draft: data.input, approved: null, attested: false })
      }
      await stream.push({ event: name, data: JSON.stringify(data) })
    }
  }
}

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const body = await readBody<StartBody>(event)
  const message = body?.message?.trim()
  if (!message || message.length > 8000) throw createError({ statusCode: 422, data: { code: 'invalid', field: 'message' } })
  const session = await runSession(event)
  // The message is counted first: a tenant over its monthly limit never reaches the service.
  await audit(event, { conversation_id: body.run_id ?? 'pending', kind: 'message', tool_name: null, input: null, result: 'ok', http_status: null, draft: null, approved: null, attested: false })
  const locale = (getHeader(event, 'cookie') ?? '').includes('i18n_redirected=en') ? 'en' : 'ar'
  const response = await serviceFetch(event, 'POST', '/v1/runs', session.owner, {
    tenant: session.owner.tenant, user_ref: session.owner.user, locale, message,
    context: body.context ?? null, tools: session.tools, limits: session.limits, run_id: body.run_id ?? null,
  })
  const stream = createEventStream(event)
  pumpRun(event, session, stream, response)
    .catch(async (error) => { await stream.push({ event: 'error', data: JSON.stringify({ code: error?.data?.code ?? 'internal', message: String(error?.message ?? error) }) }) })
    .finally(() => stream.close())
  return stream.send()
})
```

`apps/web/server/api/ai/runs/[id]/resume.post.ts`:

```ts
import { createEventStream, getRouterParam } from 'h3'
import { serviceFetch } from '../../../../utils/ai/upstream'
import { runSession } from '../../../../utils/ai/session'
import { pumpRun } from '../index.post'

type ResumeBody = { call_id?: string; decision?: 'approved' | 'rejected'; data?: Record<string, unknown> }

export default defineEventHandler(async (event) => {
  assertSameSiteJson(event)
  const id = getRouterParam(event, 'id') ?? event.context.params?.id
  const body = await readBody<ResumeBody>(event)
  if (!id || !body?.call_id || (body.decision !== 'approved' && body.decision !== 'rejected')) throw createError({ statusCode: 422, data: { code: 'invalid' } })
  const session = await runSession(event)
  const result = body.decision === 'approved' ? { ok: true, decision: 'approved', data: body.data ?? {} } : { ok: false, decision: 'rejected' }
  const response = await serviceFetch(event, 'POST', `/v1/runs/${encodeURIComponent(id)}/resume`, session.owner, { call_id: body.call_id, result })
  const stream = createEventStream(event)
  pumpRun(event, session, stream, response)
    .catch(async (error) => { await stream.push({ event: 'error', data: JSON.stringify({ code: error?.data?.code ?? 'internal', message: String(error?.message ?? error) }) }) })
    .finally(() => stream.close())
  return stream.send()
})
```

`apps/web/server/api/ai/runs/[id]/index.get.ts`:

```ts
import { getRouterParam } from 'h3'
import { AiRunStatusSchema } from '@nasq/contracts'
import { serviceFetch } from '../../../../utils/ai/upstream'
import { runSession } from '../../../../utils/ai/session'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? event.context.params?.id
  if (!id) throw createError({ statusCode: 404, data: { code: 'not_found' } })
  const session = await runSession(event)
  const response = await serviceFetch(event, 'GET', `/v1/runs/${encodeURIComponent(id)}`, session.owner)
  if (response.status === 404) throw createError({ statusCode: 404, data: { code: 'not_found' } })
  if (!response.ok) throw createError({ statusCode: 502, data: { code: 'ai_upstream' } })
  return AiRunStatusSchema.parse(await response.json())
})
```

الكتابة الخفيفة (`write_light`) عند `decision = approved` تُنفَّذ هنا أيضًا: في
`resume.post.ts` قبل نداء الخدمة، لو كانت الأداة المعلّقة من نوع `write_light` نفّذها خادم
Nuxt بنفس آلية `executeRead` (استخرج دالة `executeTool(event, session, runId, request)` تقبل
`read` و`write_light`، وفي `resume.post.ts` اجلب الطلب المعلّق من
`GET /v1/runs/{id}` وتحقق أن `call_id` يطابق، ثم نفّذ وسجّل بـ `kind: 'write_light'` ومرّر
النتيجة الحقيقية إلى الخدمة بدل `data` من المتصفح). المتصفح يرسل القرار فقط، لا بيانات.
أضف اختبارًا في `runs.wire.test.ts` يثبت أن `pmo.update_task_state` بعد موافقة ينادي
`POST /api/v1/tasks/7/transition` بالكوكي ويسجّل `write_light/ok`.

- [ ] **Step 4: شغّل الاختبارات**

Run: `npm -w apps/web test -- server/utils/ai`
Expected: PASS. لو فشل `createEventStream` في الاختبار لأن الاستيراد العام لـ `createError`
غير مُستبدل، أضفه إلى `vi.stubGlobal` في الاختبار (الاختبار أعلاه يفعل).

- [ ] **Step 5: Commit**

```bash
git add apps/web/server
git commit -m "feat(web): run Nasq AI conversations and execute tools as the caller"
```

---

### Task 4: تطبيق الويب `ai`: المانيفست والترجمة وتسجيل الطبقات

**Files:**
- Create: `apps/web/app/modules/ai/manifest.ts`
- Create: `apps/web/i18n/locales/ar/ai.json`
- Create: `apps/web/i18n/locales/en/ai.json`
- Modify: `apps/web/i18n/locales/ar/common.json` و`en/common.json` (`nav.ai`)
- Modify: `tools/arch_layers.json` (`web_apps.ai`)
- Modify: `apps/web/app/modules/__tests__/manifests.test.ts` (توقعات الترتيب)

**Interfaces:**
- Produces: مانيفست `ai` بميزة `ai.enabled`، مسار `/ai`، قدرة مستعارة `ai.use → ai.enabled`،
  رصيف ترتيب 60، اختصار `7` و`goKey: 'i'`.

- [ ] **Step 1: حدّث اختبار المانيفستات أولًا**

في `apps/web/app/modules/__tests__/manifests.test.ts`، الاختبار `discovers today's four
applications in rail order`: أضف `'ai'` إلى قائمة المعرّفات المتوقعة بعد `'hr'`، و`'ai'` إلى
قائمة الرصيف بعد `'hr'`. وفي `keeps the module feature map` أضف `ai: 'ai.enabled'`.

Run: `npm -w apps/web test -- app/modules`
Expected: FAIL (المانيفست غير موجود).

- [ ] **Step 2: اكتب المانيفست والترجمات والتسجيل**

`apps/web/app/modules/ai/manifest.ts`:

```ts
import type { AppManifest } from '../types'

// Nasq AI has no capability of its own: reading its page is opened by the feature
// `ai.enabled` through the alias below; what the assistant may do is decided per tool by Odoo.
const manifest: AppManifest = {
  id: 'ai',
  feature: 'ai.enabled',
  routePrefixes: ['/ai'],
  rail: [{ id: 'ai', labelKey: 'nav.ai', icon: 'i-lucide-sparkles', to: '/ai', order: 60 }],
  nav: [
    { to: '/ai', labelKey: 'nav.ai', icon: 'i-lucide-sparkles', shortcut: '7', goKey: 'i', capability: 'ai.use' },
  ],
  landing: [{ path: '/ai', capability: 'ai.use', late: true }],
  capabilityAliases: { 'ai.use': 'ai.enabled' },
  returnToPaths: ['/ai'],
}
export default manifest
```

`apps/web/i18n/locales/ar/ai.json`:

```json
{
  "ai": {
    "title": "Nasq AI",
    "tagline": "المنسّق الذكي لعملك",
    "description": "اسأل عن مهامك ومشاريعك، واطلب ما تريد تجهيزه. يُعدّ Nasq AI، وأنت تعتمد.",
    "composer": {
      "placeholder": "اكتب سؤالك أو طلبك…",
      "send": "إرسال",
      "sending": "جارٍ الإرسال…"
    },
    "thread": {
      "you": "أنت",
      "assistant": "Nasq AI",
      "thinking": "يفكّر…",
      "empty": "ابدأ بسؤال مثل: «ما مهامي المتأخرة؟»",
      "records": "السجلات المذكورة"
    },
    "tool": {
      "reading": "قرأ: {summary}",
      "denied": "لم يُسمح بـ: {summary}",
      "failed": "تعذّر: {summary}"
    },
    "confirm": {
      "title": "يحتاج تأكيدك",
      "approve": "نفّذ",
      "reject": "لا تنفّذ",
      "approved": "نُفّذ بعد تأكيدك",
      "rejected": "أُلغي"
    },
    "draft": {
      "title": "جهّزتُ مسودة",
      "hint": "راجعها في صفحتها الحقيقية وأرسلها بنفسك. لن يُرسل شيء قبل ذلك.",
      "open": "افتح المسودة",
      "discard": "تجاهل المسودة",
      "badge": "مسودة من Nasq AI",
      "attest": "قرأت المحتوى كاملًا وأعتمده وأتحمل مسؤوليته",
      "attestRequired": "أكّد قراءة المسودة واعتمادها قبل الإرسال"
    },
    "limits": {
      "monthly": "وصلت شركتك إلى حد رسائل Nasq AI لهذا الشهر.",
      "run": "توقف هذا الطلب لأنه تجاوز عدد الخطوات المسموح.",
      "timeout": "استغرق الطلب وقتًا أطول من المسموح.",
      "used": "{used} من {limit} رسالة هذا الشهر"
    },
    "errors": {
      "unavailable": "Nasq AI غير متاح الآن. حاول لاحقًا.",
      "provider": "تعذّر الاتصال بنموذج الذكاء. حاول لاحقًا."
    },
    "history": {
      "title": "محادثات أخيرة",
      "new": "محادثة جديدة",
      "empty": "لا محادثات بعد"
    }
  }
}
```

`apps/web/i18n/locales/en/ai.json`: نفس المفاتيح بالإنجليزية (`"title": "Nasq AI"`,
`"tagline": "Your work's AI coordinator"`, …؛ اكتب كل مفتاح).

في `ar/common.json` داخل `"nav"` أضف `"ai": "Nasq AI"`، وفي `en/common.json` كذلك.

في `tools/arch_layers.json` داخل `web_apps` أضف:

```json
    "ai": {
      "components": ["ai"],
      "pages": ["ai"]
    }
```

- [ ] **Step 3: شغّل الاختبارات**

Run: `npm -w apps/web test -- app/modules i18n tests/localeFiles.test.ts`
Expected: PASS (بما فيها اختبار تطابق ملفات اللغة بين `ar` و`en`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/modules apps/web/i18n tools/arch_layers.json
git commit -m "feat(web): register the Nasq AI application and its strings"
```

---

### Task 5: مكوّنات `components/ai` وقصصها وصفحة `/ai`

**Files:**
- Create: `apps/web/app/composables/useAiRun.ts`
- Create: `apps/web/app/composables/__tests__/useAiRun.test.ts`
- Create: `apps/web/app/components/ai/AiMessage.vue`
- Create: `apps/web/app/components/ai/AiRecordCards.vue`
- Create: `apps/web/app/components/ai/AiToolTrace.vue`
- Create: `apps/web/app/components/ai/AiConfirmCard.vue`
- Create: `apps/web/app/components/ai/AiDraftCard.vue`
- Create: `apps/web/app/components/ai/AiLimitNotice.vue`
- Create: `apps/web/app/components/ai/AiComposer.vue`
- Create: `apps/web/stories/ai/AiThread.stories.ts`
- Create: `apps/web/stories/ai/AiCards.stories.ts`
- Create: `apps/web/app/pages/ai/index.vue`

**Interfaces:**
- Produces:
  - `useAiRun()`:
    `{ runId, status, items, limit, error, send(message, context?), decide(callId, decision), load(runId) }`
    حيث `items` قائمة مرتبة من `{kind: 'user'|'assistant'|'tool'|'confirm'|'draft', ...}`؛
    `parseSseChunk(buffer) -> {events, rest}` دالة نقية مصدَّرة للاختبار.
  - المكوّنات تقبل `props` صريحة ولا تنادي الشبكة؛ الصفحة هي التي تملك `useAiRun`.

- [ ] **Step 1: اكتب اختبار المركّب الفاشل**

`apps/web/app/composables/__tests__/useAiRun.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyEvent, parseSseChunk, type AiThreadItem } from '../useAiRun'

describe('parseSseChunk', () => {
  it('splits complete blocks and keeps the remainder', () => {
    const { events, rest } = parseSseChunk('event: run\ndata: {"run_id":"r_1"}\n\nevent: token\ndata: {"text":"م')
    expect(events).toEqual([{ event: 'run', data: { run_id: 'r_1' } }])
    expect(rest).toBe('event: token\ndata: {"text":"م')
  })
})

describe('applyEvent', () => {
  const start = (): AiThreadItem[] => [{ kind: 'user', text: 'هلا' }]
  it('accumulates tokens into one assistant item and finalizes on answer', () => {
    let items = start()
    items = applyEvent(items, { event: 'token', data: { text: 'عن' } })
    items = applyEvent(items, { event: 'token', data: { text: 'دك' } })
    items = applyEvent(items, { event: 'answer', data: { text: 'عندك مهمة', records: [{ type: 'task', id: 5, label: 'تقرير' }] } })
    expect(items.at(-1)).toEqual({ kind: 'assistant', text: 'عندك مهمة', records: [{ type: 'task', id: 5, label: 'تقرير' }], streaming: false })
  })
  it('records read tools as traces and write/draft requests as pending cards', () => {
    let items = start()
    items = applyEvent(items, { event: 'tool_request', data: { call_id: 'c_1', tool: 'pmo.list_my_tasks', kind: 'read', input: {}, summary_ar: 'سأقرأ مهامك', summary_en: 'read' } })
    items = applyEvent(items, { event: 'tool_result', data: { call_id: 'c_1', tool: 'pmo.list_my_tasks', kind: 'read', ok: false, summary_ar: 'سأقرأ مهامك', summary_en: 'read' } })
    expect(items.at(-1)).toEqual({ kind: 'tool', callId: 'c_1', summaryAr: 'سأقرأ مهامك', summaryEn: 'read', state: 'denied' })
    items = applyEvent(items, { event: 'tool_request', data: { call_id: 'c_2', tool: 'pmo.draft_project', kind: 'draft', input: { name: 'بوابة' }, summary_ar: 'سأجهّز', summary_en: 'draft' } })
    expect(items.at(-1)).toMatchObject({ kind: 'draft', callId: 'c_2', tool: 'pmo.draft_project', payload: { name: 'بوابة' }, state: 'pending' })
  })
  it('marks a pending card decided', () => {
    let items = start()
    items = applyEvent(items, { event: 'tool_request', data: { call_id: 'c_3', tool: 'pmo.update_task_state', kind: 'write_light', input: { task_id: 7, state: 'done' }, summary_ar: 'سأغيّر', summary_en: 'change' } })
    items = applyEvent(items, { event: 'decided', data: { call_id: 'c_3', decision: 'approved' } })
    expect(items.at(-1)).toMatchObject({ kind: 'confirm', state: 'approved' })
  })
})
```

- [ ] **Step 2: شغّل للتأكد من الفشل**

Run: `npm -w apps/web test -- app/composables/__tests__/useAiRun.test.ts`
Expected: FAIL.

- [ ] **Step 3: اكتب المركّب**

`apps/web/app/composables/useAiRun.ts`:

```ts
import { AiEventSchema, AiRunStatusSchema, type AiEvent, type AiRecordRef } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'

export type AiThreadItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; records: AiRecordRef[]; streaming: boolean }
  | { kind: 'tool'; callId: string; summaryAr: string; summaryEn: string; state: 'running' | 'ok' | 'denied' | 'failed' }
  | { kind: 'confirm'; callId: string; tool: string; input: Record<string, unknown>; summaryAr: string; summaryEn: string; state: 'pending' | 'approved' | 'rejected' }
  | { kind: 'draft'; callId: string; tool: string; payload: Record<string, unknown>; summaryAr: string; summaryEn: string; state: 'pending' | 'approved' | 'rejected' }

type LocalEvent = AiEvent | { event: 'decided'; data: { call_id: string; decision: 'approved' | 'rejected' } }

export function parseSseChunk(buffer: string): { events: AiEvent[]; rest: string } {
  const events: AiEvent[] = []
  let rest = buffer
  let index: number
  while ((index = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, index)
    rest = rest.slice(index + 2)
    const name = block.match(/^event: (.+)$/m)?.[1]
    const data = block.match(/^data: (.+)$/m)?.[1]
    if (name && data) events.push(AiEventSchema.parse({ event: name, data: JSON.parse(data) }))
  }
  return { events, rest }
}

export function applyEvent(items: AiThreadItem[], event: LocalEvent): AiThreadItem[] {
  const next = [...items]
  const last = next.at(-1)
  switch (event.event) {
    case 'token': {
      if (last?.kind === 'assistant' && last.streaming) next[next.length - 1] = { ...last, text: last.text + event.data.text }
      else next.push({ kind: 'assistant', text: event.data.text, records: [], streaming: true })
      return next
    }
    case 'answer': {
      const item = { kind: 'assistant' as const, text: event.data.text, records: event.data.records, streaming: false }
      if (last?.kind === 'assistant' && last.streaming) next[next.length - 1] = item
      else next.push(item)
      return next
    }
    case 'tool_request': {
      const base = { callId: event.data.call_id, summaryAr: event.data.summary_ar, summaryEn: event.data.summary_en }
      if (event.data.kind === 'read') next.push({ kind: 'tool', ...base, state: 'running' })
      else if (event.data.kind === 'draft') next.push({ kind: 'draft', ...base, tool: event.data.tool, payload: event.data.input, state: 'pending' })
      else next.push({ kind: 'confirm', ...base, tool: event.data.tool, input: event.data.input, state: 'pending' })
      return next
    }
    case 'tool_result': {
      const index = next.findIndex(item => item.kind === 'tool' && item.callId === event.data.call_id)
      if (index >= 0) next[index] = { ...(next[index] as Extract<AiThreadItem, { kind: 'tool' }>), state: event.data.ok ? 'ok' : 'denied' }
      return next
    }
    case 'decided': {
      const index = next.findIndex(item => (item.kind === 'confirm' || item.kind === 'draft') && item.callId === event.data.call_id)
      if (index >= 0) next[index] = { ...(next[index] as Extract<AiThreadItem, { kind: 'confirm' | 'draft' }>), state: event.data.decision }
      return next
    }
    default:
      return next
  }
}

export function useAiRun() {
  const runId = ref<string | null>(null)
  const status = ref<'idle' | 'streaming' | 'waiting_user' | 'done' | 'failed' | 'limit_reached'>('idle')
  const items = ref<AiThreadItem[]>([])
  const limit = ref<'max_tool_calls' | 'max_steps' | 'timeout' | 'messages_monthly' | null>(null)
  const error = ref<string | null>(null)
  const { t } = useI18n()

  async function consume(response: Response) {
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      const code = body?.data?.code ?? body?.code
      if (code === 'feature_not_included' && body?.data?.details?.limit_key === 'ai.messages.monthly') { limit.value = 'messages_monthly'; status.value = 'limit_reached'; return }
      throw new ApiError(response.status, code ?? 'http_error', code === 'ai_unavailable' ? t('ai.errors.unavailable') : t('errors.generic'))
    }
    status.value = 'streaming'
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parsed = parseSseChunk(buffer)
      buffer = parsed.rest
      for (const event of parsed.events) {
        if (event.event === 'run') runId.value = event.data.run_id
        else if (event.event === 'limit_reached') limit.value = event.data.limit
        else if (event.event === 'error') error.value = event.data.code === 'provider_unavailable' ? t('ai.errors.provider') : t('errors.generic')
        else if (event.event === 'done') status.value = event.data.status === 'waiting_tool' ? 'streaming' : event.data.status
        items.value = applyEvent(items.value, event)
      }
    }
  }

  async function send(message: string, context?: { page: string; id?: number | null } | null) {
    error.value = null
    limit.value = null
    items.value = [...items.value, { kind: 'user', text: message }]
    const response = await fetch('/api/ai/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, context: context ?? null, run_id: runId.value ?? undefined }) })
    await consume(response)
  }

  /** `data` is only sent for a submitted draft (`{id}` of the created record); write_light results come from the server. */
  async function decide(callId: string, decision: 'approved' | 'rejected', data?: Record<string, unknown>) {
    if (!runId.value) return
    items.value = applyEvent(items.value, { event: 'decided', data: { call_id: callId, decision } })
    const response = await fetch(`/api/ai/runs/${encodeURIComponent(runId.value)}/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ call_id: callId, decision, data }) })
    await consume(response)
  }

  async function load(id: string) {
    const response = await fetch(`/api/ai/runs/${encodeURIComponent(id)}`)
    if (!response.ok) throw new ApiError(response.status, 'not_found', t('errors.generic'))
    const run = AiRunStatusSchema.parse(await response.json())
    runId.value = run.run_id
    status.value = run.status === 'waiting_tool' || run.status === 'running' ? 'streaming' : run.status
    let rebuilt: AiThreadItem[] = run.messages.map(m => m.role === 'user' ? { kind: 'user', text: m.content } : { kind: 'assistant', text: m.content, records: [], streaming: false })
    // The status endpoint carries no summary text; the card falls back to the tool name.
    if (run.pending) rebuilt = applyEvent(rebuilt, { event: 'tool_request', data: { ...run.pending, summary_ar: run.pending.tool, summary_en: run.pending.tool } })
    items.value = rebuilt
  }

  return { runId, status, items, limit, error, send, decide, load }
}
```

- [ ] **Step 4: اكتب المكوّنات وقصصها**

كل مكوّن صغير، يستخدم Nuxt UI فقط، ولا يستورد من تطبيق آخر. التوقيعات:

- `AiMessage.vue`: `props: { role: 'user' | 'assistant'; text: string; streaming?: boolean }`؛
  يرسم الفقاعة (`UCard` خفيف أو `div` بـ `ring ring-default bg-default rounded-lg p-3`)، اسم
  المرسل عبر `t('ai.thread.you')` / `t('ai.thread.assistant')`، ومؤشر `t('ai.thread.thinking')`
  أثناء البث.
- `AiRecordCards.vue`: `props: { records: AiRecordRef[] }`؛ يرسم `NuxtLink` لكل سجل إلى
  `/projects/{id}` أو `/tasks/{id}` حسب `type` (`project` و`task`؛ غير ذلك بلا رابط)، بعنوان
  `t('ai.thread.records')`.
- `AiToolTrace.vue`: `props: { summary: string; state: 'running' | 'ok' | 'denied' | 'failed' }`؛ سطر
  رمادي صغير بأيقونة حسب الحالة ونص `t('ai.tool.reading' | 'denied' | 'failed', { summary })`.
- `AiConfirmCard.vue`: `props: { summary: string; state: 'pending' | 'approved' | 'rejected'; disabled?: boolean }`،
  `emits: approve, reject`؛ يستخدم `SharedInlineConfirm` إن كانت واجهته تناسب (عنوان + زرّان)
  وإلا زرّين `UButton` مضمّنين. لا حوار فوقي.
- `AiDraftCard.vue`: `props: { summary: string; state: 'pending' | 'approved' | 'rejected' }`،
  `emits: open, discard`؛ عنوان `t('ai.draft.title')`، تلميح `t('ai.draft.hint')`.
- `AiLimitNotice.vue`: `props: { limit: 'max_tool_calls' | 'max_steps' | 'timeout' | 'messages_monthly'; used?: number; max?: number | null }`؛
  `UAlert` بنص الحد المناسب.
- `AiComposer.vue`: `props: { disabled: boolean; pending: boolean }`، `emits: send(text)`؛ `UTextarea`
  بسطر واحد يتمدد، إرسال بـ Enter، سطر جديد بـ Shift+Enter، زر `t('ai.composer.send')`،
  `data-testid="ai-composer"` و`data-testid="ai-send"`.

`apps/web/stories/ai/AiThread.stories.ts` يعرض محادثة كاملة (رسالة مستخدم، أثر أداة، جواب
مع بطاقتين) من المكوّنات أعلاه، و`AiCards.stories.ts` يعرض بطاقة التأكيد وبطاقة المسودة
وإشعار الحدود بحالاتها. كل قصة باسم عربي و`parameters: storyContext('apps/web/app/pages/ai/index.vue')`
و`a11y: { test: 'error' }` كما في `stories/shared/CreatePanel.stories.ts`.

- [ ] **Step 5: اكتب الصفحة**

`apps/web/app/pages/ai/index.vue`:

```vue
<script setup lang="ts">
import { AiDraftHandoffSchema } from '@nasq/contracts'
import AiComposer from '@/components/ai/AiComposer.vue'
import AiConfirmCard from '@/components/ai/AiConfirmCard.vue'
import AiDraftCard from '@/components/ai/AiDraftCard.vue'
import AiLimitNotice from '@/components/ai/AiLimitNotice.vue'
import AiMessage from '@/components/ai/AiMessage.vue'
import AiRecordCards from '@/components/ai/AiRecordCards.vue'
import AiToolTrace from '@/components/ai/AiToolTrace.vue'
import { useAiRun } from '@/composables/useAiRun'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { runId, status, items, limit, error, send, decide, load } = useAiRun()

// `?context=project:12` comes from the page the user opened the assistant from.
const context = computed(() => {
  const raw = typeof route.query.context === 'string' ? route.query.context : ''
  const match = raw.match(/^([a-z]+)(?::(\d+))?$/)
  return match ? { page: match[1]!, id: match[2] ? Number(match[2]) : null } : null
})
const busy = computed(() => status.value === 'streaming')
const summary = (item: { summaryAr: string; summaryEn: string }) => (locale.value === 'en' ? item.summaryEn : item.summaryAr)

// Reopen a run by link/refresh; a `resume` query means the create page finished a draft.
onMounted(async () => {
  const id = typeof route.query.run === 'string' ? route.query.run : null
  if (!id) return
  await load(id)
  const resume = typeof route.query.resume === 'string' ? route.query.resume : null
  if (resume) {
    const created = typeof route.query.created === 'string' ? Number(route.query.created) : null
    await router.replace({ path: '/ai', query: { run: id } })
    await resumeDraft(resume, created)
  }
})

async function resumeDraft(callId: string, createdId: number | null) {
  if (!runId.value) return
  // One resume only: the service accepts a pending call_id once (a second call answers 409).
  await decide(callId, createdId ? 'approved' : 'rejected', createdId ? { id: createdId } : undefined)
}

function openDraft(item: { callId: string; tool: string; payload: Record<string, unknown> }) {
  if (!runId.value) return
  const draftId = `${runId.value}:${item.callId}`
  const handoff = AiDraftHandoffSchema.parse({ run_id: runId.value, call_id: item.callId, tool: item.tool, payload: item.payload })
  try { sessionStorage.setItem(`nasq:ai-draft:${draftId}`, JSON.stringify(handoff)) } catch { /* private mode: the page still opens empty */ }
  router.push({ path: '/projects/new', query: { aiDraft: draftId, returnTo: `/ai?run=${runId.value}&resume=${item.callId}` } })
}

async function onSend(text: string) {
  await send(text, context.value)
  if (runId.value && route.query.run !== runId.value) await router.replace({ path: '/ai', query: { ...route.query, run: runId.value } })
}
</script>

<template>
  <SharedPageContainer width="detail" data-template="ai-conversation">
    <SharedPageHeader :title="t('ai.title')" :description="t('ai.tagline')" />
    <section class="flex min-h-[60svh] flex-col gap-4" aria-live="polite">
      <SharedEmptyState v-if="items.length === 0" :text="t('ai.thread.empty')" data-testid="ai-empty" />
      <template v-for="(item, index) in items" :key="index">
        <AiMessage v-if="item.kind === 'user'" role="user" :text="item.text" />
        <template v-else-if="item.kind === 'assistant'">
          <AiMessage role="assistant" :text="item.text" :streaming="item.streaming" />
          <AiRecordCards v-if="item.records.length" :records="item.records" />
        </template>
        <AiToolTrace v-else-if="item.kind === 'tool'" :summary="summary(item)" :state="item.state" />
        <AiConfirmCard v-else-if="item.kind === 'confirm'" :summary="summary(item)" :state="item.state" :disabled="!hydrated || busy" @approve="decide(item.callId, 'approved')" @reject="decide(item.callId, 'rejected')" />
        <AiDraftCard v-else :summary="summary(item)" :state="item.state" @open="openDraft(item)" @discard="decide(item.callId, 'rejected')" />
      </template>
      <AiLimitNotice v-if="limit" :limit="limit" />
      <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
      <AiComposer class="mt-auto" :disabled="!hydrated || limit === 'messages_monthly'" :pending="busy" @send="onSend" />
    </section>
  </SharedPageContainer>
</template>
```

- [ ] **Step 6: شغّل الاختبارات والفحص الثابت**

```bash
npm -w apps/web test -- app/composables/__tests__/useAiRun.test.ts app/modules
npm -w apps/web run lint
cd apps/web && npm run build-storybook >/dev/null && cd ../..
```

Expected: الاختبارات تمر، `vue-tsc` نظيف، وStorybook يُبنى. ثم اختبار RTL للقصص:
`cd apps/web && STORYBOOK_RTL_PORT=6098 npm run test:rtl` يمر (كل قصة بلا تمرير جانبي).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/composables/useAiRun.ts apps/web/app/composables/__tests__/useAiRun.test.ts apps/web/app/components/ai apps/web/stories/ai apps/web/app/pages/ai
git commit -m "feat(web): add the Nasq AI page, thread components and stories"
```

---

### Task 6: مسودة المشروع في صفحة الإنشاء الحقيقية مع الإقرار

**Files:**
- Create: `apps/web/app/utils/aiDraft.ts`
- Create: `apps/web/app/utils/__tests__/aiDraft.test.ts`
- Modify: `apps/web/app/components/pmo/projects/ProjectCharterForm.vue` (prop `initialDraft`، إقرار الإرسال)
- Modify: `apps/web/app/components/pmo/projects/ProjectCreateForm.vue` (قراءة `?aiDraft`)
- Modify: `apps/web/app/pages/projects/new.vue` (تدقيق الاعتماد بعد الإنشاء والعودة)
- Modify: `apps/web/i18n/locales/{ar,en}/projects.json` (`projects.create.aiBadge`, `projects.create.aiAttest`, `projects.create.aiAttestRequired`)

ملاحظة الملكية: هذه الملفات تملكها PMO؛ التعديل محدود بقراءة مسودة محايدة الشكل
(`AiDraftHandoff` من `@nasq/contracts`) ولا يستورد شيئًا من `components/ai` (R3).

**Interfaces:**
- Produces:
  - `readAiDraft(draftId: string): AiDraftHandoff | null` (من `sessionStorage`، يتجاهل التالف).
  - `clearAiDraft(draftId)`.
  - `charterDraftFromAi(payload: AiDraftPayload, base: CharterDraft): CharterDraft` يملأ الحقول
    المعروفة فقط.
  - `ProjectCharterForm` prop جديدة `initialDraft?: AiDraftPayload | null` و`attestRequired?: boolean`؛
    عندما `attestRequired` يظهر `UCheckbox` بالإقرار في الخطوة الأخيرة و`canSubmit` يشترطه.
  - `ProjectCharterForm` يطلق `created` كما هو؛ الصفحة `projects/new.vue` تكمل التدقيق.

- [ ] **Step 1: اكتب اختبار الأداة الفاشل**

`apps/web/app/utils/__tests__/aiDraft.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { charterDraftFromAi } from '../aiDraft'
import { emptyCharterDraft } from '../projectCharter'

describe('charterDraftFromAi', () => {
  it('fills known fields and turns objectives into rows', () => {
    const draft = charterDraftFromAi({ name: 'بوابة', description: 'وصف', date_start: '2026-11-01', date_end: '2027-03-31', charter: { rationale: 'لماذا', objectives: ['أ', 'ب'], scope: 'نطاق' } }, emptyCharterDraft())
    expect(draft.name).toBe('بوابة')
    expect(draft.description).toBe('وصف')
    expect([draft.dateStart, draft.dateEnd]).toEqual(['2026-11-01', '2027-03-31'])
    expect(draft.rationale).toBe('لماذا')
    expect(draft.scope).toBe('نطاق')
    expect(draft.objectives.map(o => o.goal)).toEqual(['أ', 'ب'])
    expect(draft.objectives.every(o => !o.persisted)).toBe(true)
  })
  it('leaves untouched fields at their base values', () => {
    const base = emptyCharterDraft()
    base.userId = 9
    const draft = charterDraftFromAi({ name: 'x' }, base)
    expect(draft.userId).toBe(9)
    expect(draft.objectives).toHaveLength(1)
  })
})
```

- [ ] **Step 2: شغّل للتأكد من الفشل**

Run: `npm -w apps/web test -- app/utils/__tests__/aiDraft.test.ts`
Expected: FAIL.

- [ ] **Step 3: اكتب الأداة وعدّل النموذج والصفحة**

`apps/web/app/utils/aiDraft.ts`:

```ts
import { AiDraftHandoffSchema, type AiDraftHandoff, type AiDraftPayload } from '@nasq/contracts'
import { emptyObjective, type CharterDraft } from './projectCharter'

const KEY = (id: string) => `nasq:ai-draft:${id}`

/** The draft `/ai` left for `/projects/new?aiDraft=<id>`; a missing or corrupt entry is null, never a crash. */
export function readAiDraft(draftId: string): AiDraftHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY(draftId))
    return raw ? AiDraftHandoffSchema.parse(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function clearAiDraft(draftId: string): void {
  try { sessionStorage.removeItem(KEY(draftId)) } catch { /* nothing to clear */ }
}

/** Prefills only the charter fields the AI draft knows; everything else keeps the form's own defaults. */
export function charterDraftFromAi(payload: AiDraftPayload, base: CharterDraft): CharterDraft {
  const charter = payload.charter ?? {}
  const objectives = charter.objectives?.length ? charter.objectives.map(goal => ({ ...emptyObjective(false), goal })) : base.objectives
  return {
    ...base,
    name: payload.name,
    description: payload.description ?? base.description,
    dateStart: payload.date_start ?? base.dateStart,
    dateEnd: payload.date_end ?? base.dateEnd,
    rationale: charter.rationale ?? base.rationale,
    objectives,
    scope: charter.scope ?? base.scope,
    exclusions: charter.exclusions ?? base.exclusions,
    success: charter.success ?? base.success,
    assumptions: charter.assumptions ?? base.assumptions,
    constraints: charter.constraints ?? base.constraints,
  }
}
```

في `ProjectCharterForm.vue`:

1. أضف إلى `defineProps` السطرين:
   ```ts
     /** A Nasq AI draft: applied once, after the create defaults, before the baseline snapshot. */
     initialDraft?: AiDraftPayload | null
     /** The create submit needs the user's attestation (a draft prepared by Nasq AI). */
     attestRequired?: boolean
   ```
   مع `import type { AiDraftPayload } from '@nasq/contracts'` و`import { charterDraftFromAi } from '@/utils/aiDraft'`.
2. في الـ `watch` الذي يطبّق `createDefaults` (السطر ~155) بعد `draft.value.userId = value.default_manager_id`
   وقبل `baseline.value = snapshotDraft(draft.value)` أضف:
   ```ts
         if (props.initialDraft) draft.value = charterDraftFromAi(props.initialDraft, draft.value)
   ```
   (المسودة قبل اللقطة الأساسية فلا تُعدّ "تغييرًا غير محفوظ" عند الفتح، لكن أي تعديل بعدها يُعدّ.)
3. أضف `const attested = ref(false)` وغيّر `canSubmit`:
   ```ts
   const canSubmit = computed(() => hydrated.value && !pending.value && !props.readonly && !!draft.value.name.trim() && (!props.attestRequired || attested.value))
   ```
4. في القالب قبل `<div class="flex flex-wrap items-center gap-2" data-testid="charter-wizard-actions">` أضف:
   ```vue
         <div v-if="attestRequired && isLastStep" class="rounded-lg border border-default p-3" data-testid="project-create-attest">
           <UCheckbox v-model="attested" :label="t('projects.create.aiAttest')" required />
           <p v-if="!attested" class="mt-1 text-xs text-muted">{{ t('projects.create.aiAttestRequired') }}</p>
         </div>
   ```
   وفي رأس النموذج (أول عنصر داخل `<form>`) شارة:
   ```vue
         <UBadge v-if="attestRequired" color="primary" variant="subtle" data-testid="project-create-ai-badge">{{ t('projects.create.aiBadge') }}</UBadge>
   ```

في `ProjectCreateForm.vue`:

```ts
import { readAiDraft } from '@/utils/aiDraft'
const aiDraftId = computed(() => (typeof route.query.aiDraft === 'string' ? route.query.aiDraft : null))
const aiDraft = computed(() => (hydrated.value && aiDraftId.value ? readAiDraft(aiDraftId.value) : null))
```

ومرّر إلى `<ProjectCharterForm ... :initial-draft="aiDraft?.payload ?? null" :attest-required="!!aiDraft" />`.
لأن `sessionStorage` غير متاح في SSR، تُقرأ المسودة بعد الترطيب فقط؛ وبما أن
`createDefaults` تصل لاحقًا كذلك فالـ `watch` يطبّقها في الوقت الصحيح. لو وصلت `defaults`
قبل الترطيب (نادر) أضف إلى الـ `watch` مراقبة `() => props.initialDraft` وطبّقها مرة واحدة
عند تحولها من `null` إلى قيمة بشرط `!isCharterDraftDirty(draft.value, baseline.value)`.

في `pages/projects/new.vue` داخل `onCreated(id)`:

```ts
import { clearAiDraft, readAiDraft } from '@/utils/aiDraft'
import { useApi } from '@/composables/useApi'
const { $api } = useApi()
async function onCreated(id: number) {
  toast.add({ title: t('projects.created'), color: 'success' })
  const draftId = typeof route.query.aiDraft === 'string' ? route.query.aiDraft : null
  const handoff = draftId ? readAiDraft(draftId) : null
  if (handoff) {
    await $api('/api/v1/ai/audit', { method: 'POST', body: {
      conversation_id: handoff.run_id, kind: 'draft', tool_name: handoff.tool, input: handoff.payload, result: 'approved',
      http_status: 201, draft: handoff.payload, approved: { id }, attested: true,
    } }).catch(() => undefined)
    clearAiDraft(draftId!)
    router.push(`${returnTo.value}&created=${id}`)
    return
  }
  router.push(createdProjectLocation(id, returnTo.value))
}
```

ووسّع `safeReturnTo(route.query.returnTo, '/projects', ['/projects'])` إلى `['/projects', '/ai']`.

أضف إلى `projects.json` (ar):

```json
    "aiBadge": "مسودة من Nasq AI",
    "aiAttest": "قرأت المحتوى كاملًا وأعتمده وأتحمل مسؤوليته",
    "aiAttestRequired": "أكّد قراءة المسودة واعتمادها قبل الإرسال"
```

داخل `projects.create`، ونظيرها الإنجليزي في `en/projects.json`.

- [ ] **Step 4: شغّل الاختبارات والفحص الثابت**

```bash
npm -w apps/web test -- app/utils app/components
npm -w apps/web run lint
```

Expected: PASS ونظيف. ثم حدّث قصة `stories/project/ProjectCharterForm.stories.ts` بقصة
جديدة «مسودة من Nasq AI» تمرر `initialDraft` و`attestRequired: true` لتظهر الشارة والإقرار.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/utils/aiDraft.ts apps/web/app/utils/__tests__/aiDraft.test.ts apps/web/app/components/pmo/projects apps/web/app/pages/projects/new.vue apps/web/i18n apps/web/stories/project
git commit -m "feat(pmo): open a Nasq AI project draft in the real create page with attestation"
```

---

### Task 7: الخادم الوهمي، اختبار Playwright من طرف إلى طرف، وCI

**Files:**
- Create: `apps/web/e2e/ai-service-mock.mjs`
- Modify: `apps/web/e2e/internal-ui-audit-mock.mjs` (مسارا `/api/v1/ai/*`)
- Create: `apps/web/e2e/ai-mocked.spec.ts`
- Modify: `apps/web/e2e/ci-mock-specs.txt`
- Modify: `.woodpecker.yml` (خطوة `e2e-mock`: تشغيل الخادم الوهمي للخدمة و`NUXT_AI_SERVICE_URL`)
- Modify: `docs/testing.md` (قسم Playwright mock specs)

- [ ] **Step 1: اكتب الخادم الوهمي للخدمة**

`apps/web/e2e/ai-service-mock.mjs` (بلا تبعيات؛ نفس أسلوب `internal-ui-audit-mock.mjs`):

```js
// A scripted Nasq AI service for the mock stack: no model, deterministic runs.
// Message containing «مشروع» → draft request; otherwise → one read tool then an answer.
import http from 'node:http'

const PORT = Number(process.env.AI_MOCK_PORT ?? 4499)
const runs = new Map()

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  res.end()
}
const readBody = req => new Promise((resolve) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => resolve(b)) })
const owner = req => `${req.headers['x-nasq-tenant']}|${req.headers['x-nasq-user']}`

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const body = JSON.parse((await readBody(req)) || '{}')
  if (req.method === 'POST' && url.pathname === '/v1/runs') {
    const id = body.run_id ?? `r_${runs.size + 1}`
    const run = runs.get(id) ?? { owner: owner(req), messages: [], pending: null, status: 'running' }
    runs.set(id, run)
    run.messages.push({ role: 'user', content: body.message })
    if (/مشروع/.test(body.message)) {
      run.pending = { call_id: `c_${run.messages.length}`, tool: 'pmo.draft_project', kind: 'draft', input: { name: 'بوابة إرادة', charter: { objectives: ['إطلاق البوابة'] } } }
      run.status = 'waiting_user'
      return sse(res, [['run', { run_id: id }], ['tool_request', { ...run.pending, summary_ar: 'سأجهّز مسودة مشروع', summary_en: 'I will prepare a project draft' }], ['done', { status: 'waiting_user' }]])
    }
    run.pending = { call_id: `c_${run.messages.length}`, tool: 'pmo.list_my_tasks', kind: 'read', input: { limit: 10 } }
    run.status = 'waiting_tool'
    return sse(res, [['run', { run_id: id }], ['tool_request', { ...run.pending, summary_ar: 'سأقرأ مهامك', summary_en: 'I will read your tasks' }], ['done', { status: 'waiting_tool' }]])
  }
  const resume = url.pathname.match(/^\/v1\/runs\/([^/]+)\/resume$/)
  if (req.method === 'POST' && resume) {
    const run = runs.get(resume[1])
    if (!run || run.owner !== owner(req)) { res.writeHead(404); return res.end('{}') }
    if (!run.pending || run.pending.call_id !== body.call_id) { res.writeHead(409); return res.end('{}') }
    const wasDraft = run.pending.kind === 'draft'
    run.pending = null
    run.status = 'done'
    const text = wasDraft
      ? (body.result.decision === 'approved' ? 'أُنشئ المشروع بعد اعتمادك.' : 'حسنًا، ألغيت المسودة.')
      : (body.result.ok ? `عندك ${body.result.data.total} مهمة، منها «${body.result.data.items[0]?.name ?? '—'}».` : 'لا تملك صلاحية قراءة المهام.')
    run.messages.push({ role: 'assistant', content: text })
    const records = !wasDraft && body.result.ok ? body.result.data.items.slice(0, 3).map(i => ({ type: 'task', id: i.id, label: i.name })) : (wasDraft && body.result.decision === 'approved' ? [{ type: 'project', id: body.result.data.id, label: 'بوابة إرادة' }] : [])
    return sse(res, [['run', { run_id: resume[1] }], ['token', { text: text.slice(0, 5) }], ['answer', { text, records }], ['done', { status: 'done' }]])
  }
  const get = url.pathname.match(/^\/v1\/runs\/([^/]+)$/)
  if (req.method === 'GET' && get) {
    const run = runs.get(get[1])
    if (!run || run.owner !== owner(req)) { res.writeHead(404); return res.end('{}') }
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ run_id: get[1], status: run.status, messages: run.messages, pending: run.pending }))
  }
  if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}') }
  res.writeHead(404); res.end('{}')
}).listen(PORT, '127.0.0.1', () => process.stderr.write(`ai mock on ${PORT}\n`))
```

- [ ] **Step 2: أضف مسارات أودو الوهمية**

في `apps/web/e2e/internal-ui-audit-mock.mjs` بعد سطر `if (!hasSession(req)) return fail(...)`
(داخل كتلة `/api/v1/`) أضف:

```js
  if (method === 'GET' && path === '/api/v1/ai/tools') {
    const caps = capabilitiesForRequest(req.headers.cookie, moduleUiCapabilities)
    const items = [
      { name: 'pmo.list_my_tasks', kind: 'read', description: { ar: 'يعرض مهامي', en: 'List my tasks' }, input_schema: { type: 'object', properties: { limit: { type: 'integer' } } }, route: { method: 'GET', path: '/api/v1/tasks' }, input_map: { query: { filter: 'mine', limit: '$limit' } }, result_summary: ['items[].id', 'items[].name', 'items[].state', 'total'], draft_target: null },
      ...(caps.includes('pmo.projects.create') ? [{ name: 'pmo.draft_project', kind: 'draft', description: { ar: 'مسودة مشروع', en: 'Project draft' }, input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, route: null, input_map: {}, result_summary: [], draft_target: '/projects/new' }] : []),
    ]
    return json(res, 200, { items, total: items.length, limits: { tool_calls_per_run: 8, messages_monthly: 500, messages_used: AI_AUDIT.filter(a => a.kind === 'message').length } })
  }
  if (method === 'POST' && path === '/api/v1/ai/audit') {
    let entry = {}
    try { entry = JSON.parse(await readBody(req) || '{}') } catch { entry = {} }
    AI_AUDIT.push(entry)
    return json(res, 200, { id: AI_AUDIT.length, messages_used: AI_AUDIT.filter(a => a.kind === 'message').length, messages_limit: 500 })
  }
  if (method === 'GET' && path === '/__mock/ai-audit') return json(res, 200, { items: AI_AUDIT })
```

وأعلى الملف بجانب الثوابت: `const AI_AUDIT = []`. تأكد أن `ME.entitlements` في الخادم الوهمي
و`/api/v1/me` تحوي `'ai.enabled': true` (ابحث عن `'chat.enabled': true` وأضف بجانبه)، وإلا لن
يظهر `/ai` في الرصيف.

- [ ] **Step 3: اكتب اختبار Playwright**

`apps/web/e2e/ai-mocked.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test.describe('Nasq AI on the mock stack', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/اسم المستخدم|login/i).fill('admin')
    await page.getByLabel(/كلمة المرور|password/i).fill('admin')
    await page.getByRole('button', { name: /دخول|sign in/i }).click()
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('answers a read question with record cards and audits the tool', async ({ page, request }) => {
    await page.goto('/ai')
    await expect(page.getByRole('heading', { level: 1, name: 'Nasq AI' })).toBeVisible()
    await page.getByTestId('ai-composer').fill('وش مهامي؟')
    await page.getByTestId('ai-send').click()
    await expect(page.getByText('سأقرأ مهامك')).toBeVisible()
    await expect(page.getByText(/عندك \d+ مهمة/)).toBeVisible()
    await expect(page.getByRole('link', { name: /.+/ }).filter({ hasText: /.+/ }).first()).toBeVisible()
    await expect(page).toHaveURL(/\/ai\?run=r_/)
    const audit = await (await request.get(`${process.env.NUXT_ODOO_URL}/__mock/ai-audit`)).json()
    expect(audit.items.map((a: any) => [a.kind, a.result])).toEqual(expect.arrayContaining([['message', 'ok'], ['read', 'ok']]))
  })

  test('a project request opens the real create page prefilled and needs attestation', async ({ page }) => {
    await page.goto('/ai')
    await page.getByTestId('ai-composer').fill('سوّ لي مشروع للبوابة')
    await page.getByTestId('ai-send').click()
    await expect(page.getByText('جهّزتُ مسودة')).toBeVisible()
    await page.getByRole('button', { name: 'افتح المسودة' }).click()
    await expect(page).toHaveURL(/\/projects\/new\?aiDraft=/)
    await expect(page.getByTestId('project-create-ai-badge')).toBeVisible()
    await expect(page.getByLabel(/اسم المشروع|الاسم/)).toHaveValue('بوابة إرادة')
    // walk to the last step
    while (await page.getByTestId('charter-step-next').isVisible()) await page.getByTestId('charter-step-next').click()
    await expect(page.getByTestId('project-create-submit')).toBeDisabled()
    await page.getByTestId('project-create-attest').getByRole('checkbox').check()
    await expect(page.getByTestId('project-create-submit')).toBeEnabled()
    await page.getByTestId('project-create-submit').click()
    await expect(page).toHaveURL(/\/ai\?run=r_/)
    await expect(page.getByText('أُنشئ المشروع بعد اعتمادك')).toBeVisible()
  })

  test('reopening a waiting run shows its pending card', async ({ page }) => {
    await page.goto('/ai')
    await page.getByTestId('ai-composer').fill('أبغى مشروع جديد')
    await page.getByTestId('ai-send').click()
    await expect(page.getByText('جهّزتُ مسودة')).toBeVisible()
    await page.reload()
    await expect(page.getByText('جهّزتُ مسودة')).toBeVisible()
    await page.getByRole('button', { name: 'تجاهل المسودة' }).click()
    await expect(page.getByText('ألغيت المسودة')).toBeVisible()
  })
})
```

أضف `ai-mocked.spec.ts` إلى `apps/web/e2e/ci-mock-specs.txt`.

(تسميات حقول الدخول والاسم: اقرأها من `app/pages/login.vue` و`ProjectCharterFields.vue` واستخدم
`data-testid` الموجودة إن وُجدت بدل النص؛ النص أعلاه هو المقصد لا الحرف.)

- [ ] **Step 4: شغّل المكدس الوهمي محليًا**

من `apps/web` (منافذ حرة؛ لا تلمس 3000/8069):

```bash
PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT=4498 node e2e/internal-ui-audit-mock.mjs &
AI_MOCK_PORT=4499 node e2e/ai-service-mock.mjs &
NUXT_ODOO_URL=http://127.0.0.1:4498 NUXT_ODOO_DB=nasq_ui_mock_only NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4498/websocket NUXT_AI_SERVICE_URL=http://127.0.0.1:4499 npx nuxt dev --port 4097 &
E2E_BASE_URL=http://localhost:4097 E2E_PROJECT_POPUPS=1 npx playwright test e2e/ai-mocked.spec.ts
```

Expected: الاختبارات الثلاثة تمر. التقط لقطات `ar` و`en` للصفحة بالوضعين عبر
`npx playwright screenshot` لإرفاقها بالتقرير.

- [ ] **Step 5: CI والتوثيق**

في خطوة `e2e-mock` في `.woodpecker.yml` بعد تشغيل `internal-ui-audit-mock.mjs`:

```yaml
        AI_MOCK_PORT=4499 node e2e/ai-service-mock.mjs > ai-mock.log 2>&1 &
        AI_MOCK_PID=$!
        export NUXT_AI_SERVICE_URL=http://127.0.0.1:4499
```

وأضف `kill "$AI_MOCK_PID"` في `cleanup()`. في `docs/testing.md` قسم «Playwright mock specs»
أضف فقرة: الخادم الوهمي للخدمة ومتغير `NUXT_AI_SERVICE_URL` و`__mock/ai-audit`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e .woodpecker.yml docs/testing.md
git commit -m "test(web): cover Nasq AI end to end on the mock stack"
```

---

### Task 8: النشر: حاوية الخدمة وقاعدتها في compose

**Files:**
- Modify: `deploy/docker-compose.yml`
- Modify: `deploy/docker-compose.shared.yml`
- Create: `deploy/ai/init-db.sql`
- Create: `deploy/ai/.env.example`
- Modify: `deploy/OPERATIONS.md`
- Modify: `deploy/test_classification.py` فقط إن كان يعدّ خدمات compose (اقرأه أولًا؛ لو كان
  يقارن نصًا حرفيًا أضف الخدمة الجديدة إلى التوقع).

- [ ] **Step 1: أضف الخدمة إلى compose المخصص**

في `deploy/docker-compose.yml` بعد خدمة `odoo` وقبل `db`:

```yaml
  ai:
    build: { context: ../apps/ai-service }
    restart: unless-stopped
    environment:
      AI_PROVIDER: "${AI_PROVIDER:-ollama}"
      AI_MODEL: "${AI_MODEL:?set AI_MODEL}"
      AI_API_KEY: "${AI_API_KEY:-}"
      AI_BASE_URL: "${AI_BASE_URL:-}"
      AI_DATABASE_URL: "postgresql://odoo:${DB_PASSWORD}@db:5432/nasq_ai"
      AI_RUN_RETENTION_DAYS: "${AI_RUN_RETENTION_DAYS:-30}"
    expose: ["8600"]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8600/healthz', timeout=2)"]
      interval: 5s
      timeout: 10s
      retries: 20
    depends_on:
      db: { condition: service_healthy }
```

وفي خدمة `web` أضف `NUXT_AI_SERVICE_URL: http://ai:8600` إلى `environment` و`ai: { condition: service_healthy }`
إلى `depends_on`. وفي خدمة `db` أضف المجلد:

```yaml
      - ./ai/init-db.sql:/docker-entrypoint-initdb.d/20-nasq-ai.sql:ro
```

`deploy/ai/init-db.sql`:

```sql
-- Nasq AI keeps its run state in its own database, beside the tenant database, never inside it.
CREATE DATABASE nasq_ai OWNER odoo;
```

`deploy/ai/.env.example`:

```
# Nasq AI provider for this deployment. Sovereign customers use ollama with a local AI_BASE_URL.
AI_PROVIDER=ollama
AI_MODEL=qwen2.5:7b
AI_BASE_URL=http://ollama:11434
AI_API_KEY=
AI_RUN_RETENTION_DAYS=30
```

- [ ] **Step 2: أضف الخدمة إلى compose المشترك**

في `deploy/docker-compose.shared.yml`:

```yaml
  ai:
    networks: [guard_web, database]
    ports: !reset []
```

وفي `web` أضف `NUXT_AI_SERVICE_URL: http://ai:8600`. الخدمة على `guard_web` تصل إليها
`web` فقط، وعلى `database` تصل إلى `db`؛ لا منفذ خارجي.

- [ ] **Step 3: وثّق التشغيل**

في `deploy/OPERATIONS.md` أضف قسمًا «Nasq AI»: المتغيرات، أن الخدمة اختيارية (غياب
`NUXT_AI_SERVICE_URL` يخفي `/ai`)، أمر التنظيف الدوري
`docker compose exec ai python -m nasq_ai_service.cleanup` (يُجدول بكرون المضيف)، وأن
إيقاف `ai` لا يعطل بقية نسق.

- [ ] **Step 4: تحقق**

```bash
cd deploy && docker compose -f docker-compose.yml config --quiet && docker compose -f docker-compose.yml -f docker-compose.shared.yml config --quiet && cd ..
python3 -B -m unittest discover -s deploy -p 'test_*.py'
```

Expected: كلاهما 0. (لو لم يتوفر Docker فشغّل اختبارات `deploy` فقط وسجّل أن `config` لم يُشغَّل.)

- [ ] **Step 5: Commit**

```bash
git add deploy
git commit -m "feat(deploy): run the Nasq AI service beside web and odoo"
```

---

### Task 9: البوابات الكاملة والتقرير

- [ ] **Step 1: البوابات**

```bash
npm test
npm -w apps/web run lint
python3 -B tools/arch_policy.py --base main
python3 -B tools/git_policy.py --base main
python3 -B tools/catalog_check.py
```

Expected: الكل يمر. `arch_policy`: لا R3 جديد (الصفحة والمكوّنات لا تستورد من تطبيق آخر؛
`components/pmo` يستورد من `@/utils/aiDraft` و`@nasq/contracts` فقط).

- [ ] **Step 2: المكدس الحقيقي على البيئة المعزولة**

شغّل أودو على 8174 بقاعدة السكراتش (بعد الخطة أ)، والخدمة من `apps/ai-service` على 8600
بـ `AI_PROVIDER=ollama` ونموذج محلي أو مزوّد سحابي بمفتاح من بيئتك، وNuxt على 3104 بـ
`NUXT_AI_SERVICE_URL=http://127.0.0.1:8600`. سجّل دخول موظف تجريبي، اسأل عن مهامك، واطلب
مشروعًا حتى الإقرار. التقط لقطتين وأرفقهما بالتقرير.

- [ ] **Step 3: التقرير**

الملفات المتغيرة، مخرجات الأوامر، اللقطات، وما لم يُتحقق منه (مثل Docker إن لم يكن
متاحًا). لا دمج ولا دفع؛ الدمج قرار المالك بعد مراجعة `odoo-reviewer` للأدون والعقود.
