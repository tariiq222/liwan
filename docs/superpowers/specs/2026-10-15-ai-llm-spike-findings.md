# نتائج التجربة: هل يصلح apexive/odoo-llm (`llm` + `llm_tool`، فرع 19.0) أساسًا لمساعد نسق الذكي؟

**الحالة — 2026-10-15:** تجربة قراءة فقط داخل worktree
`codex/platform-ai-assistant`. لا يوجد أي تغيير في `odoo-addons` ولا commit. كل
الأدلة أدناه من قاعدة السكراتش `nasq_scratch_platform_ai_assistant` على المنفذ
8174، والسجلات في `.scratch/logs/`. المستودع المستنسخ في
`.scratch/vendor/odoo-llm` (19.0، آخر commit `c5c99465` بتاريخ 2026-05-09) و
`.scratch/vendor/odoo-llm-18` (18.0، `609ec6dd` بتاريخ 2026-05-26)، وكلاهما خارج Git.

## 1. الحكم المختصر

**نبني طبقتنا بأنفسنا ونستعير التصميم، لا نعتمد على الكود كتبعية.**
(`build own` مع `adopt partially` على مستوى الأفكار فقط.)

الأسباب الحاسمة، كل واحد منها كافٍ وحده:

1. **فرع 19.0 لا يستطيع مخاطبة أي نموذج لغوي.** قائمة `service` في `llm.provider`
   فارغة (`_get_available_services` يعيد `[]`)، ووحدات المزوّدين (`llm_openai`،
   `llm_anthropic`، `llm_ollama`) موجودة على 18.0 فقط. إنشاء مزوّد عبر ORM مستحيل
   لأن الحقل `required` بلا خيارات. أي استخدام فعلي يعني نقل مزوّد واحد على الأقل
   (`llm_anthropic`: 540 سطر Python على 18.0).
2. **مفتاح API مكشوف لكل مستخدم داخلي.** `api_key` حقل `Char` عادي بلا `groups`،
   وقاعدة الوصول تعطي `base.group_user` قراءة كاملة على `llm.provider`. الفحص أدناه
   يثبت أن مستخدمًا داخليًا عاديًا قرأ المفتاح مباشرة، وقرأه أيضًا عبر أداة
   `odoo_record_retriever`.
3. **الأدوات الافتراضية عامة على ORM وتُرى لكل المستخدمين.** الخمس أدوات
   (`odoo_record_retriever/creator/updater/unlinker`، `odoo_model_inspector`) تصنيفها
   `general` و`default=True`، فتظهر لأي مستخدم داخلي. هذا عكس مبدأ نسق: أدوات مسمّاة
   لكل تطبيق فوق مسارات `json2` وفحوص capability، لا أدوات ORM عامة.
4. **"موافقة المستخدم" في `llm_tool` تلميح في الـ prompt وليست بوابة في الكود.**
   `requires_user_consent` يُحقن كنص في رسالة النظام
   (`_inject_tool_consent`) ويُترك للنموذج أن "يسأل". لا يوجد سجل انتظار ولا موافقة
   مسجّلة. مبدأ نسق «الذكاء يجهّز والإنسان يوافق» يحتاج بوابة مفروضة بالكود مثل
   `ai.pending.action` من NullNaveen/odoo-ai-assistant.
5. **نقل 19.0 غير مكتمل:** ثلاثة مسارات في الوحدتين مكسورة على Odoo 19 (القسم 6)،
   والاختبارات الـ 26 لا تغطيها.
6. **واجهة الدردشة في 18.0 كلها OWL/`@mail`** (2,703 سطر JS تعتمد على
   `@mail/core/common/*` و`chatter`). واجهة نسق Nuxt، فهذه الطبقة تُرمى بالكامل.

ما يستحق الاستعارة من التصميم (بدون نسخ الكود كما هو): نمط `_dispatch` للمزوّد
(`<service>_chat`، `<service>_format_tools`)، مُزخرف `@llm_tool` مع
`_register_hook` لتسجيل الأدوات كسجلات، تعليقات الأدوات على نمط MCP
(`readOnlyHint`/`destructiveHint`)، حقلا `llm_role` و`body_json` على `mail.message`،
قفل `pg_advisory_lock` لكل محادثة، ومسار بث SSE بمولّد Python.

## 2. أدلة الأوامر

البيئة: Odoo 19 من `/Users/tariq/code/odoo` (Python 3.12.13)، addons path:
`odoo/addons,addons,<worktree>/odoo-addons,<worktree>/.scratch/vendor/odoo-llm`،
الإعداد `.scratch/scratch.conf`، `--http-port=8174 --workers=0 --max-cron-threads=0`.

### 2.1 الاعتماديات الخارجية

- venv أودو لا يحوي `pydantic` ولا `mcp` ولا `pip` ولا `packaging`. لم يُعدَّل
  `/Users/tariq/code/odoo/.venv`.
- الحل المؤقت: `uv pip install --target .scratch/vendor/pydeps` ثم `PYTHONPATH`،
  مع حذف كل حزمة موجودة أصلًا في الـ venv (`cryptography`، `cffi`، `attrs`، `idna`،
  `pycparser`، `typing_extensions`) لأن نسخة `cryptography` الأحدث كسرت
  `OpenSSL.crypto` (`AttributeError: module 'lib' has no attribute 'GEN_EMAIL'`).
- `packaging` مطلوب أيضًا: بدونه يفشل أودو في قراءة `pydantic>=2.0.0` من المانيفست
  (`Package 'packaging' is required to parse ... external dependency`).
- الحجم النهائي للمجلد ~28 ميجابايت (`mcp`، `pydantic`، `pydantic_core`، `starlette`،
  `uvicorn`، `httpx`، `anyio`، `jsonschema`، ...). هذه الشجرة ستدخل صورة الإنتاج لو
  اعتمدنا الوحدة.

### 2.2 التثبيت

```
2026-10-15 11:22:10,082 ... odoo.modules.loading: Loading module llm (69/70)
2026-10-15 11:22:10,488 ... odoo.modules.loading: Loading module llm_tool (70/70)
2026-10-15 11:22:11,073 ... odoo.modules.loading: Modules loaded.
```

السجل: `.scratch/logs/llm-spike-install.log`. التثبيت نجح من المحاولة الأولى بعد
تجهيز الاعتماديات.

### 2.3 اختبارات الوحدتين (`--test-tags /llm,/llm_tool`)

| المحاولة | الاعتمادية | النتيجة |
|---|---|---|
| 1 (`-i llm,llm_tool`) | `mcp 2.3.0` (أحدث نسخة، كما يسمح المانيفست) | `0 failed, 7 error(s) of 26 tests` |
| 2 (`-u llm,llm_tool`) | `mcp 1.30.0` (`mcp<2`) | `0 failed, 0 error(s) of 26 tests` |

سبب الأخطاء السبعة واحد: `llm_tool/models/llm_tool.py:202` يستورد
`mcp.server.fastmcp.utilities.func_metadata`، وهذا المسار أُزيل في mcp 2.x
(`ModuleNotFoundError: No module named 'mcp.server.fastmcp' ... pin 'mcp<2'`).
المانيفست يذكر `"mcp"` بلا تثبيت إصدار. السجلان:
`.scratch/logs/llm-spike-install.log` و`.scratch/logs/llm-spike-tests-mcp1.log`.
لا توجد اختبارات في `llm` نفسها؛ الـ 26 كلها في `llm_tool/tests`
(`test_llm_tool_core`، `test_llm_tool_schema`، `test_llm_tool_concurrency`).

### 2.4 فحص سلوكي في `odoo shell` (كل شيء داخل savepoint ثم `rollback`)

السكربت `.scratch/llm_spike_probe.py` و`llm_spike_probe2.py`. النتيجة الخام:

```
service_selection_19: []
provider_created: true   (أُدخل الصف بـ SQL مباشر لأن ORM يرفض service فارغًا)
api_key_read_by_internal_user: "sk-SECRET-123"
tools_visible_to_internal_user: [odoo_model_inspector, odoo_record_creator,
  odoo_record_retriever, odoo_record_unlinker, odoo_record_updater]
all_tools_and_category: retriever(general, consent=false, default=true),
  creator(general, true, true), updater(general, true, true),
  unlinker(general, true, true), model_method_executor(technical, true, false),
  model_inspector(general, false, true)
retriever_as_internal_user_res_users: ["admin", "spike_internal"]
retriever_as_internal_user_llm_provider: [{"id": 3, "name": "spike-probe",
  "api_key": "sk-SECRET-123"}]
llm_role_computed: "user"
to_store_format_19: TypeError("MailMessage._to_store() missing 1 required
  positional argument: 'fields'")
message_post_body_json_kwarg_19: ValueError('Those values are not supported
  when posting or notifying: body_json')
```

## 3. جرد الوحدات

| الوحدة | الفرع | ملفات | Python | ملاحظة |
|---|---|---|---|---|
| `llm` | 19.0 | 28 | ~640 سطر (`llm_provider.py` 400، `mail_message.py` 112، `llm_model.py` 88، wizard 125) | يعتمد على `mail`، `web` |
| `llm_tool` | 19.0 | 39 | ~2,000 سطر (`llm_tool.py` 517، `model_inspector` 434، `mail_message.py` 321، `decorators.py` 215، 4 أدوات ORM) | يعتمد على `base`، `mail`، `llm`؛ خارجي: `pydantic`، `mcp` |
| `llm_mcp_server` | 19.0 | 38 | ~1,100 سطر | خادم MCP على `/mcp` بـ bearer؛ خارج نطاق هذه التجربة |
| `llm_thread` | 18.0 فقط | 50 | 920 Python + 2,703 JS + 1,203 XML | المحادثة والبث وواجهة OWL |
| `llm_anthropic` | 18.0 فقط | 14 | 540 | يحتاج `anthropic` |
| `llm_openai` | 18.0 فقط | 18 | 1,147 | يحتاج `openai`، ويعتمد على `llm_training` |
| `llm_ollama` | 18.0 فقط | 17 | 880 | يحتاج `ollama` |

الفرق بين `llm` 18.0 و19.0: 662 سطر diff (المزايا نفسها؛ تغييرات `res.groups.privilege`
و`models.Constraint` وتوقيعات). `llm_tool`: 877 سطر diff.

## 4. مراجعة مقابل قواعد نسق R1–R10

| القاعدة | النتيجة في `llm` + `llm_tool` (19.0) |
|---|---|
| R1/R4 اتجاه التبعية | `llm` ← `mail`،`web`؛ `llm_tool` ← `llm`. لا تعتمد على أي تطبيق أودو آخر (جيد). لو أُدخلت، رتبتها 3 (خدمة مشتركة) وتُسجَّل في `tools/arch_layers.json` تحت `exempt` لأن المانيفست (المؤلف، التصنيف `Technical`، الترويسة) لا يطابق قواعد نسق. |
| R2 كل تطبيق يملك صلاحياته | مجموعة واحدة `llm.group_llm_manager` + `base.group_system`. لا capability ولا ربط بـ `nasq.access.service`. |
| R3 لا استيراد بين التطبيقات | `_register_hook` في `llm.tool` يمسح **كل** نماذج السجل (`for model_name in self.env.registry`) ويستدعي `dir()` على كل صنف عند الإقلاع. ليس استيرادًا، لكنه اقتران زمن تشغيل بكل شيء، وزمن إقلاع إضافي. |
| R5 بدون control plane | لا مشكلة. |
| R6 لا شرط على اسم عميل | لا مشكلة. |
| R7 `sudo()` | **صفر** في `llm` و`llm_tool` (grep). `llm_mcp_server` فيه `sudo()` واحد لقراءة `web.base.url`. `llm_thread` (18.0) فيه `sudo().write` واحد في `set_user_vote`. |
| R8 saas/non_saas | لا تمييز؛ لا `commercial_mode`. يُضاف من جهتنا. |
| R9 نقاط التمديد العامة فقط | لا SQL مباشر في الوحدتين. لا override لدوال خاصة في أودو عدا `_register_hook` (نقطة تمديد معلنة). `llm_thread` 18.0 يستخدم `cr.execute("SELECT pg_advisory_lock/unlock")` (ليس جدول أودو، لكنه SQL مباشر) ويُعيد تعريف `_message_fetch` و`_extras_to_store` و`_thread_to_store` و`_init_messaging` (كلها خاصة في `mail`). |
| R10 سجل المزايا | لا يوجد. كل مسار يحتاج `<app>.enabled` وربط بـ `nasq.feature.registry`. |

نقاط إضافية من قواعد `docs/agents/odoo-rules.md`: المسارات في `llm_thread` تستخدم
`type="json"` و`type="http"` (SSE) وليس `json2`/`api_handler`؛ لا serializers
بقائمة بيضاء (`search_read` يعيد الحقول كما هي)؛ لا `i18n/ar.po`؛ الترويسة
والمؤلف لا يطابقان.

## 5. كيف تعمل الأدوات والمزوّدون فعليًا

**التسجيل.** مُزخرف `@llm_tool` في `llm_tool/decorators.py` يضع أعلامًا على الدالة
(`_is_llm_tool`، `_llm_tool_name`، `_llm_tool_schema`، تلميحات MCP). عند الإقلاع
`llm.tool._register_hook` يمسح السجل كله وينشئ/يحدّث سجل `llm.tool` لكل دالة
مزخرفة (`implementation=function`، `decorator_model`، `decorator_method`)، داخل
`savepoint(flush=False)` لتحمّل تعدد الـ workers، ويعطّل الأدوات التي اختفت من
الكود. الأدوات المدمجة (`odoo_record_*`) تُعرَّف في XML بـ
`implementation=<name>` وتُنفَّذ عبر `<name>_execute`.

**من ينفّذ وبأي صلاحيات.** `llm.tool.execute(parameters)` يبني نموذج pydantic من
توقيع الدالة ثم يستدعيها على `self.env[decorator_model]`، أي **بمستخدم البيئة
الحالية** بلا أي رفع. من `mail.message.execute_tool_call` يُمرَّر
`with_context(message=...)` فقط. من MCP: `execute_mcp_tool` يبحث بـ `search()` بلا
sudo (قواعد السجل حسب `category`) ثم `execute`. أي فحص إضافي للصلاحية (capability
نسق) غير موجود؛ الاعتماد كله على ACL/record rules للنموذج المستهدف. مع أداة
`odoo_model_method_executor` يمكن استدعاء أي دالة عامة على أي نموذج، وبـ
`allow_private=true` حتى الخاصة.

**ظهور الأدوات.** قواعد السجل في `security/llm_tool_rules.xml`: `general` لكل
`base.group_user`، والكل لـ `group_system` و`group_llm_manager`. التوسيع المقترح
عندهم: `selection_add` على `category` من وحدات جسر. لا ربط بسياق محادثة.

**المزوّدون والمفاتيح.** `llm.provider` سجل لكل قاعدة (أي لكل مستأجر في نموذج
نسق) بحقل `company_id` إجباري و`api_key`/`api_base` كـ `Char` بلا تشفير وبلا
`groups`. العرض يخفي المفتاح (`password="True"`) لكن ORM لا يخفيه (القسم 2.4).
`_check_unique_name` يبحث في كل الشركات. قائمة `service` تُملأ من وحدات المزوّدين
عبر `_get_available_services`، وهي فارغة على 19.0.

**البث (streaming).** على 19.0 موجود كاسم وسيط فقط: `chat(stream=False)` يمرّره
إلى `_dispatch("chat")` ولا يوجد منفّذ. على 18.0 البث حقيقي: المزوّد يعيد مولّدًا
(`_anthropic_stream_response` مع `client.messages.stream`، و
`_openai_process_streaming_response` يجمّع `tool_calls`)، و`llm.thread.generate`
يُنتج أحداثًا (`message_create`، `message_chunk`، `tool_called`، `tool_succeeded`،
`tool_failed`، `done`)، والمتحكم `/llm/thread/generate` (`type="http"`) يكتبها
كـ `text/event-stream` بـ `direct_passthrough=True` على cursor جديد من
`Registry(dbname).cursor()`. هذا النمط صالح للنقل إلى نسق كمسار `http` بجانب
`json2`.

## 6. مسارات مكسورة في نقل 19.0 (مثبتة)

1. `llm/models/mail_message.py:103` `to_store_format` يستدعي `self._to_store(store)`،
   وفي 19 التوقيع `_to_store(self, store, fields, *, ...)` → `TypeError`.
2. `llm_tool/models/mail_message.py:post_tool_call` يستدعي
   `thread_model.message_post(body_json=..., llm_role=..., author_id=False)`؛ في 19
   `message_post` يرفض الحقول غير المدرجة في `_get_message_create_valid_field_names`
   → `ValueError: Those values are not supported when posting or notifying: body_json`.
   (18.0 `llm_thread` كان يوسّع القائمة؛ 19.0 لا يحوي من يفعل ذلك.)
3. الفرع البديل في الدالة نفسها ينشئ `mail.message` بـ `"subtype_xmlid"` كحقل →
   `ValueError: Invalid field 'subtype_xmlid' in 'mail.message'` (ليس حقلًا في أي
   إصدار).
4. المانيفست لا يثبّت `mcp<2` (القسم 2.3).

## 7. تقدير نقل `llm_thread` من 18.0

الحجم: 920 سطر Python (`llm_thread.py` 700، `mail_message.py` 83، `res_users.py` 18،
`controllers/main.py` 115)، 2,703 JS، 1,203 XML، واعتماديات `emoji`، `markdown2`،
و`jinja2` للقوالب.

واجهات 18.0 التي تحتاج تعديلًا على 19:

- `mail.thread._thread_to_store(store, **kwargs)` → في 19
  `_thread_to_store(store, fields, *, request_list=None)`.
- `mail.message._message_fetch(domain, search_term, before, after, around, limit)` →
  في 19 `(domain, *, thread=None, search_term=None, is_notification=None, ...)`.
- `odoo.osv.expression.AND` → مهمل في 19 لصالح `odoo.fields.Domain`.
- `message_post(llm_role=, body_json=, is_error=)` يحتاج توسيع
  `_get_message_create_valid_field_names`.
- `to_store_format` و`Store` (القسم 6).
- `mail.message._extras_to_store(store, format_reply)` و`res.users._init_messaging(store)`
  و`bus.bus._sendone` موجودة بالتوقيع نفسه في 19 (لا تغيير).
- المسار `type="json"` → في 19 الاسم `jsonrpc`؛ في نسق يصبح `json2`.
- `cr.execute` لقفل `pg_advisory_lock` يبقى كما هو (ليس جدول أودو) لكنه يحتاج
  توثيقًا تحت R9.

الجزء الفعلي القابل للنقل لنسق هو Python فقط (~900 سطر، منها ~400 منطق المحادثة
والقفل والأحداث). الـ JS والـ XML (3,900 سطر) تُرمى لأن واجهة نسق Nuxt. التقدير:
يومان لنقل Python وتعديل التوقيعات، لكن بما أننا سنعيد كتابته فوق `json2`
وcapabilities وبوابة الموافقة، كتابته من الصفر باستعارة التصميم تكلفتها مماثلة
وتُنتج كودًا يطابق قواعدنا من اليوم الأول.

## 8. ما يجب أن تكتبه نسق بنفسها (في كل السيناريوهات)

1. **`nasq_ai` (رتبة 3، خدمة مشتركة)**: نماذج `nasq.ai.provider` (مفتاح بحقل
   محمي بـ `groups=base.group_system` أو تخزين خارج ORM، شركة/مستأجر، `commercial_mode`)،
   `nasq.ai.model`، `nasq.ai.thread`، امتداد `mail.message` بـ `llm_role`/`body_json`
   مع توسيع `_get_message_create_valid_field_names`.
2. **عميل مزوّد واحد على الأقل** (Anthropic أولًا) بنمط `_dispatch`، مع بث حقيقي
   وتجميع `tool_calls`. لا يوجد شيء على 19.0 لنأخذه؛ 18.0 `llm_anthropic` مرجع
   للشكل (540 سطر).
3. **سجل أدوات مسمّى لكل تطبيق**: مُزخرف يشبه `@llm_tool` لكنه يُسجَّل داخل كل
   تطبيق (R2) مع `capability` إجبارية وتصنيف `read_only`/`destructive`، والتنفيذ
   يمر بفحص `nasq.access.service` ثم بمسار `json2` الموجود، لا `self.env[model]`
   عام. لا `odoo_record_*` ولا `model_method_executor`.
4. **بوابة الموافقة بالكود** `nasq.ai.pending.action` (على نسق NullNaveen):
   كل أداة غير `read_only` تنشئ سجل انتظار بحالة `proposed`، ولا تُنفَّذ إلا عند
   `approve` من مستخدم يملك الـ capability، مع تسجيل من اقترح ومن وافق. لا اعتماد
   على نص prompt.
5. **مسارات `json2` + مسار SSE** واحد (`type='http'`) للبث، بنمط مولّد وcursor مستقل
   كما في `llm_thread/controllers/main.py`، مع `api_handler` وأخطاء مهيكلة.
6. **R10**: تسجيل `ai.enabled` والمزايا الفرعية والحدود (عدد الرسائل/الأدوات) في
   `nasq.feature.registry`، وإخفاء الميزة في `non_saas` إن كانت تجارية.
7. **واجهة Nuxt** للمحادثة ولوحة الإجراءات المعلّقة (مكوّنات من Storybook).
8. **اختبارات** `NasqApiCase` للبوابة والصلاحيات والبث، و`i18n/ar.po`.
9. **تسجيل الاعتماديات** (`anthropic` أو `httpx` فقط؛ تجنب `mcp` و`pydantic` إن لم
   نحتج خادم MCP) في صورة النشر، مع تثبيت الإصدارات.

## 9. ما يمكن استعارته حرفيًا من odoo-llm (LGPL-3، مع ذكر المصدر)

- بنية `_dispatch(method, *args, record=None)` في `llm_provider.py:46-60`.
- فكرة `_register_hook` + `savepoint(flush=False)` لتسجيل الأدوات مع تعدد الـ workers
  (`llm_tool.py:260-400`)، مقيّدة عندنا بنماذج `nasq_*` فقط.
- تعليقات الأدوات بأسماء MCP (`readOnlyHint`، `destructiveHint`، `idempotentHint`).
- `llm_role` محسوب ومخزّن من `subtype_id` مع `ormcache` (`llm/models/mail_message.py`).
- قفل المحادثة بـ `pg_advisory_lock` ومولّد الأحداث وSSE (18.0 `llm_thread`).

## 10. تنظيف

لا شيء دخل Git: `git status` في الـ worktree يُظهر هذا الملف فقط. المستودعان
المستنسخان ومجلد `pydeps` والسكربتان والسجلات كلها تحت `.scratch/` (مُتجاهَل).
قاعدة السكراتش تحوي الآن `llm` و`llm_tool` مثبتتين؛ لإزالتهما قبل أي عمل
لاحق على القاعدة نفسها: إعادة إنشاء القاعدة أو `-u` بعد حذف المسار من
`--addons-path` ليست كافية، والأبسط إسقاط القاعدة وإعادة إنشائها من وحدات نسق.
