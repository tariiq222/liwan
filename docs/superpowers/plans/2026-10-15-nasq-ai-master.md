# Nasq AI — المرحلة الأولى: الخطة الرئيسية والعقود المشتركة

> **For agentic workers:** هذه الخطة الرئيسية لا تُنفَّذ مباشرة. نفّذ الخطط الفرعية بالترتيب
> (أ ثم ب ثم ج)، كل واحدة بـ superpowers:subagent-driven-development أو
> superpowers:executing-plans. هذا الملف يملك العقود التي تتقاسمها الخطط الثلاث؛ أي تغيير
> في عقد يُعدَّل هنا أولًا ثم في الخطط التي تستهلكه.

**Goal:** موظف يسأل Nasq AI عن مهامه ومشاريعه فيجيبه بصلاحياته، ويطلب مشروعًا فيجد
صفحة الإنشاء الحقيقية معبّأة ويرسلها بنفسه بإقرار.

**Architecture:** أودو يملك البيانات والصلاحيات وسجل الأدوات والتدقيق (`nasq_ai`، رتبة 3).
خدمة بايثون معزولة (`apps/ai-service`، LangGraph) تقرر وتوقف عند كل أداة بلا أي اعتماد.
خادم Nuxt ينفّذ الأدوات بكوكي المستخدم ويبث إلى صفحة `/ai`.

**Tech Stack:** Odoo 19 Community، Python 3.12، FastAPI، LangGraph 1.x مع
`langgraph-checkpoint-postgres`، `langchain-anthropic` / `langchain-openai` /
`langchain-ollama`، Nuxt 4 (Nitro + h3)، Nuxt UI من Storybook، Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-15-nasq-ai-design.md`](../specs/2026-10-15-nasq-ai-design.md)

## الخطط الفرعية

| الخطة | الملف | تُنتج | تعتمد على |
|---|---|---|---|
| أ: أودو | [`2026-10-15-nasq-ai-a-odoo.md`](2026-10-15-nasq-ai-a-odoo.md) | أدون `nasq_ai`، أدوات PMO الست، مساران `/api/v1/ai/*`، تسجيل الكتالوج والطبقات | لا شيء |
| ب: الخدمة | [`2026-10-15-nasq-ai-b-service.md`](2026-10-15-nasq-ai-b-service.md) | `apps/ai-service` بواجهة `/v1/runs` وSSE ومزوّد وهمي للاختبار | عقود هذا الملف فقط |
| ج: الواجهة والنشر | [`2026-10-15-nasq-ai-c-web.md`](2026-10-15-nasq-ai-c-web.md) | `apps/web/server/api/ai/*`، صفحة `/ai`، مسودة المشروع بالإقرار، compose وCI | أ وب مثبتتان على قاعدة السكراتش |

أ وب مستقلتان ويمكن تنفيذهما بالتوازي في worktrees منفصلة (ملكيات ملفات لا تتقاطع). ج
تبدأ بعد اكتمالهما.

**طريقة التنفيذ (قرار المالك 2026-10-15):** subagent-driven بوكلاء `worker` على **Sonnet**
لكل مهمة، ومراجع `reviewer` (Sonnet) بعد كل مهمة، ثم `odoo-reviewer` على الفرع كاملًا قبل
أي دمج. لا يُستخدم Fable ولا Opus في التنفيذ.

## Global Constraints

- الفرع `codex/platform-ai-assistant`؛ كومتات بصيغة `type(scope): subject` والنطاق
  `platform` لأدون `nasq_ai` والخدمة، `pmo` لأدوات PMO، `web` للواجهة، `deploy` للنشر.
  لا كومت ولا دمج ولا دفع بلا إذن المالك؛ الخطوات التي تقول "commit" تعني تجهيز الكومت
  وطلب الإذن إن لم يكن ممنوحًا للجلسة.
- `nasq_ai` رتبة 3: يعتمد على `nasq_api` فقط، لا يسمّي أي تطبيق، لا `sudo()`، لا SQL
  مباشر، لا تجاوز لدوال خاصة (R1–R9). يُسجَّل في `tools/arch_layers.json` برتبة 3 قبل
  أي كومت يضيف ملفاته.
- كل ملف بايثون يبدأ بـ `# Part of Odoo. See LICENSE file for full copyright and licensing details.`
  والمانيفست: `LGPL-3`، المؤلف `Tariq Alwalidi`، التصنيف `Hidden`.
- المسارات `type='json2'`, `auth='user'`, `methods` صريحة، `@api_handler`، وبوابة ميزة
  (`requires_registered_feature` للخدمة المشتركة). قوائم بصيغة `{items, total}`.
- الخدمة لا تملك أي اعتماد لنسق ولا تنادي أي عنوان خارج مزوّد النموذج.
- النصوص الظاهرة للمستخدم عبر `t()` في مساحة `ai`؛ العربية أولًا وRTL.
- لا اختبار على قاعدة `odoo19`. قاعدة السكراتش `nasq_scratch_platform_ai_assistant`،
  منافذ 8174 و3104 (`.env.worktree`).
- Node 22 لاختبارات الويب. `npm test` و`python3 -B tools/arch_policy.py --base main`
  و`python3 -B tools/git_policy.py --base main` تمر قبل أي دمج.

## العقود المشتركة

### ع1. تعريف الأداة (أودو ← Nuxt ← الخدمة)

كما يعيده `GET /api/v1/ai/tools`:

```json
{
  "items": [
    {
      "name": "pmo.list_my_tasks",
      "kind": "read",
      "description": {"ar": "يعرض مهام المستخدم الحالي", "en": "List the current user's tasks"},
      "input_schema": {
        "type": "object",
        "properties": {
          "state": {"type": "string", "enum": ["in_progress", "changes_requested", "approved", "waiting", "done", "cancelled"]},
          "limit": {"type": "integer", "minimum": 1, "maximum": 50}
        },
        "additionalProperties": false
      },
      "route": {"method": "GET", "path": "/api/v1/tasks"},
      "input_map": {"query": {"filter": "mine", "state": "$state", "limit": "$limit"}},
      "result_summary": ["items[].id", "items[].name", "items[].state", "items[].date_deadline", "items[].is_overdue", "items[].project.name", "total"],
      "draft_target": null
    }
  ],
  "total": 6,
  "limits": {"tool_calls_per_run": 8, "messages_monthly": 500, "messages_used": 12}
}
```

- `kind` ∈ `read | write_light | draft`.
- `route` إلزامي لغير `draft`، و`null` للـ `draft`؛ `draft_target` العكس (مسار صفحة في
  الواجهة مثل `/projects/new`).
- `input_map` ثلاثة مفاتيح اختيارية `path` و`query` و`body`؛ القيمة النصية التي تبدأ بـ `$`
  تُستبدل بقيمة المدخل بالاسم نفسه، وما لا يبدأ بـ `$` ثابت. مدخل غير موجود يُحذف من
  الطلب. `path` يملأ `{name}` في `route.path`.
- `result_summary` مسارات نقطية؛ `[]` يعني كل عنصر في مصفوفة. ما ليس في القائمة لا يصل
  إلى النموذج.
- `limits` قيمة `null` تعني بلا حد.

### ع2. واجهة الخدمة (Nuxt ← الخدمة)

`POST /v1/runs` جسم:

```json
{
  "tenant": "nasq_scratch_platform_ai_assistant",
  "user_ref": "42",
  "locale": "ar",
  "message": "وش مهامي المتأخرة؟",
  "context": {"page": "project", "id": 12},
  "tools": [ /* عناصر ع1 كما هي */ ],
  "limits": {"max_steps": 12, "max_tool_calls": 8, "timeout_seconds": 120}
}
```

`POST /v1/runs/{run_id}/resume` جسم:

```json
{"call_id": "c_01", "result": {"ok": true, "data": {"items": [], "total": 0}}}
```

أو عند الرفض أو الخطأ:

```json
{"call_id": "c_01", "result": {"ok": false, "error": {"code": "forbidden", "message": "..."}}}
```

أو قرار المستخدم على تأكيد أو مسودة:

```json
{"call_id": "c_02", "result": {"ok": true, "decision": "approved", "data": {"id": 77, "name": "..."}}}
{"call_id": "c_02", "result": {"ok": false, "decision": "rejected"}}
```

`GET /v1/runs/{run_id}` يعيد `{run_id, status, messages: [{role, content}], pending: {call_id, tool, kind, input} | null}`.
`status` ∈ `running | waiting_tool | waiting_user | done | failed | limit_reached`.

كلا المسارين يردان `text/event-stream`. كل حدث سطر `event: <name>` ثم `data: <json>`:

| event | data |
|---|---|
| `run` | `{"run_id": "r_…"}` (أول حدث دائمًا) |
| `token` | `{"text": "…"}` |
| `tool_request` | `{"call_id": "c_01", "tool": "pmo.list_my_tasks", "kind": "read", "input": {…}, "summary_ar": "سأقرأ مهامك", "summary_en": "I will read your tasks"}` |
| `answer` | `{"text": "…", "records": [{"type": "task", "id": 5, "label": "…"}]}` |
| `limit_reached` | `{"limit": "max_tool_calls" \| "max_steps" \| "timeout"}` |
| `error` | `{"code": "provider_unavailable" \| "internal", "message": "…"}` |
| `done` | `{"status": "waiting_tool" \| "waiting_user" \| "done" \| "failed" \| "limit_reached"}` (آخر حدث دائمًا) |

بعد `tool_request` يأتي `done` بحالة `waiting_tool` (لـ `read`) أو `waiting_user` (لـ
`write_light` و`draft`)، ويُغلق البث. المتابعة عبر `resume`.

الخدمة ترفض أداة ليست في `tools[]` بخطأ داخل الرسم البياني (تُعاد للنموذج كنتيجة
`{"ok": false, "error": {"code": "unknown_tool"}}`) ولا تبث `tool_request` لها.

### ع3. مسارات خادم Nuxt (المتصفح ← Nuxt)

| المسار | الجسم | الرد |
|---|---|---|
| `POST /api/ai/runs` | `{message, context?, run_id?}` | SSE بنفس أحداث ع2، مع حدث إضافي `tool_result` `{"call_id", "tool", "kind", "ok", "summary_ar", "summary_en"}` بعد كل تنفيذ قراءة |
| `POST /api/ai/runs/:id/resume` | `{call_id, decision: "approved" \| "rejected", data?}` | SSE |
| `GET /api/ai/runs/:id` | | نفس رد `GET /v1/runs/{id}` من الخدمة |

عند `tool_request` من نوع `read` خادم Nuxt لا يبث `done` للمتصفح؛ ينفّذ، يبث
`tool_result`، يستأنف الخدمة، ويواصل البث في نفس الاتصال. عند `write_light` و`draft`
يمرر `tool_request` ثم `done` كما هما.

### ع4. التدقيق (Nuxt → أودو)

`POST /api/v1/ai/audit` جسم:

```json
{
  "conversation_id": "r_01HZX…",
  "kind": "message",
  "tool_name": null,
  "input": null,
  "result": "ok",
  "http_status": null,
  "draft": null,
  "approved": null,
  "attested": false
}
```

- `kind` ∈ `message | read | write_light | draft`. `tool_name` إلزامي لغير `message` ويجب
  أن يكون اسم أداة مسجلة.
- `result` ∈ `ok | denied | failed | proposed | approved | rejected`. للـ `draft`:
  `proposed` عند التجهيز، ثم `approved` (مع `approved` و`attested: true`) أو `rejected`.
- الرد: `{"id": 9, "messages_used": 13, "messages_limit": 500}`.
- `kind = message` يرفع عدّاد الشهر؛ تجاوز `ai.messages.monthly` يرد 403
  `feature_not_included` مع `details.limit_key = "ai.messages.monthly"`.
- `input` و`draft` و`approved` تُخزَّن كما وصلت بعد إزالة أي مفتاح اسمه `password` أو
  `token` أو `api_key` (تنظيف بسيط في الخادم).

### ع5. حمولة مسودة المشروع (الخدمة → Nuxt → صفحة الإنشاء)

`input` لأداة `pmo.draft_project` ومن ثم `payload` المسودة:

```json
{
  "name": "بوابة إرادة",
  "description": "…",
  "date_start": "2026-11-01",
  "date_end": "2027-03-31",
  "charter": {
    "rationale": "…",
    "objectives": ["…", "…"],
    "scope": "…",
    "exclusions": "…",
    "success": "…",
    "assumptions": "…",
    "constraints": "…"
  }
}
```

كل المفاتيح اختيارية عدا `name`. الواجهة تخزّنها تحت المفتاح
`nasq:ai-draft:<draft_id>` في `sessionStorage` وتفتح
`/projects/new?aiDraft=<draft_id>&returnTo=/ai?run=<run_id>`.

### ع6. أسماء الميزات والحدود

| المفتاح | النوع | المالك |
|---|---|---|
| `ai.enabled` | boolean | `nasq_ai` |
| `ai.messages.monthly` | limit (رسائل في الشهر الميلادي UTC لكل شركة) | `nasq_ai` |
| `ai.tool_calls.per_run` | limit (أدوات في التشغيل الواحد) | `nasq_ai` |

## Review Focus

1. **مستخدم بلا قدرة** يطلب أداة لم تُرسل له: الخدمة ترفض داخليًا، ولو وصل طلب تنفيذ
   إلى Nuxt لأداة ليست في كتالوج هذا الطلب يُرفض قبل أي نداء لأودو (اختبار في ج).
2. **أودو يرد 403 على أداة في الكتالوج** (قدرة سياقية سُحبت أثناء المحادثة): النتيجة
   تعود للنموذج مهيكلة ويُسجَّل `denied`، ولا تتوقف المحادثة (اختبار في أ وج).
3. **حمولة مسودة فيها مفاتيح غير معروفة أو `name` فارغ**: صفحة الإنشاء تتجاهل المجهول
   وتترك الحقل فارغًا، ولا تنهار (اختبار في ج).
4. **انقطاع البث في منتصف تشغيل**: إعادة فتح `/ai?run=<id>` تعرض الحالة من
   `GET /api/ai/runs/:id`، والتشغيل المعلّق يُستأنف من حيث توقف (اختبار في ب وج).
5. **بلوغ حد الرسائل الشهري**: الرفض يأتي من أودو برمز `feature_not_included` ويعرضه
   الواجهة كرسالة حدود لا كخطأ عام (اختبار في أ وج).

## ملاحق التنفيذ (2026-10-16)

ما تغيّر عن النص أعلاه أثناء التنفيذ والمراجعة، والكود هو المرجع:

- **أدوات PMO في جسر:** تُعلن في الأدون الجديد `nasq_pmo_ai` (رتبة 5، تثبيت تلقائي، يعتمد على
  `nasq_pmo` و`nasq_ai`) بدل `nasq_pmo`. سبب القرار: اعتماد PMO على `nasq_ai` كان يسحب `nasq_ai` إلى
  كل كتالوج قديم فيكسر `catalog_check`. `nasq_pmo` بلا أي تعديل. مالك الأداة يبقى `nasq_pmo`.
- **التدقيق:** التحقق كله في `create()` لنموذج `nasq.ai.audit` (نقطة واحدة تغطي المسار و`json/2`):
  مفاتيح موثّقة فقط، المستخدم والشركة من البيئة، فحص قدرة الأداة وميزتها، `ai.enabled`، حد
  الرسائل الشهري تحت قفل صف الشركة. صفوف `message` بلا محتوى ومقروءة على مستوى الشركة بقاعدة
  سجل (بدل `sudo()` للعد).
- **أسماء الأدوات عند المزوّد:** العقد ع1/ع2 تبقى بنقطة (`pmo.list_my_tasks`)؛ الخدمة تشفّرها
  `.`→`__` عند `bind_tools` فقط وتفكّها بخريطة لكل تشغيل.
- **الخدمة:** `finish()` بدل `set_status` (لا يكتب إلا فوق `running`)، و`acquire()` ذرّي للاستئناف
  والمتابعة، والـ system prompt يُبنى من الحالة في كل نداء ولا يُخزَّن، والتنظيف بـ `updated_at`
  في معاملة واحدة ويحتاج `AI_DATABASE_URL` و`AI_RUN_RETENTION_DAYS` فقط.
