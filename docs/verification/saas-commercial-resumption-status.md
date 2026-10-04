# حالة استئناف القبول التجاري SaaS — وثيقة مؤقتة (ليست إغلاقًا)

> **نطاق هذه الوثيقة:** وثيقة حالة استئناف بالأدلة فقط. لا تغييرات كود/تهيئة/تشغيل/DB، لا commit، لا merge، لا deploy. المالك الوحيد لهذا الملف: مهمة الاستئناف الحالية داخل worktree `/Users/tariq/.codex/worktrees/saas-commercial/nasq` على الفرع `codex/saas-commercial`.

## الهدف
توثيق حالة استئناف قبول `live-20261007-acceptance` بعد فشل التزويد الفعلي (E04) وحظر الحالات التابعة، مع الحفاظ على كل البيانات والبوابات، ودون أي إعادة محاولة عمياء أو حذف أو إيصالات مختلقة.

## الحالة الحالية
**غير جاهز للإغلاق — محظور على فشل التزويد Baa (E04 FAIL) وحاجة تدخل تشغيلي مُراجَع.** لا يوجد إصلاح كود خلال هذه الاستئناف. هذا تقرير استئناف مؤقت، وليس وثيقة إغلاق.

## بيانات التنفيذ المُتحقَّق منها
- `pwd` = `/Users/tariq/.codex/worktrees/saas-commercial/nasq`؛ الفرع `codex/saas-commercial`؛ الشجرة غير نظيفة (تعديلات قائمة قبل هذه المهمة، ملكياتها لفرق أخرى — لم تُمَس).
- تمت قراءة `AGENTS.md`/`CLAUDE.md`/`docs/parallel-work.md` (قابلية تعارض الملفات المشتركة) قبل أي كتابة.

## ما أُنجز مع دليل (استئناف docs-only)
- **قراءة تقرير القبول المتكامل** — الدليل: `docs/verification/saas-commercial-integrated-acceptance.md` (يشمل مقاطع التشغيلات `live-20261005/06/07-acceptance`).
- **قراءة تشخيص التزويد بوضع القراءة فقط** — الدليل: `tools/saas_commercial_acceptance/.evidence/live-20261007-acceptance/provision-diagnosis.json` (generatedAt `2026-10-03T02:40:00Z`، mode: read-only-diagnosis).
- **قراءة تقرير التشغيل الحي** — الدليل: `tools/saas_commercial_acceptance/.evidence/live-20261007-acceptance/report.md`.
- **قراءة أدلة A/B النهائية** — الدليل: `docs/verification/saas-commercial-a.md` و`docs/verification/saas-commercial-b.md` (كلاهما يحمل تنبيه: النتائج اختبارات subagent وليست CI).
- **كتابة هذا الملف** — الدليل: `docs/verification/saas-commercial-resumption-status.md` (الملف الجديد الوحيد في هذه المهمة).

## حالة البوابة: مهمة Baa `047cd198-fb75-43b0-8ef6-aea548a670f6`
حالة مُطبَّقة جزئيًا، موثقة مصدرًا في `provision-diagnosis.json`:
- قاعدة بيانات المستأجر موجودة (`nasq_scratch_994d366949764302bfb66bb70425093a`، 326 جدولًا) والموديولات `nasq_core/nasq_platform/nasq_api` مركّبة (pmo/hr/chat غير مركّبة — متوقَّع حسب سياسة الوظيفة).
- `nasq_tenant_profile.policy_revision = 0`، ولوجين `admin` ما زال الافتراضي — مرحلة policy لم تكتمل، ومرحلة password لم تبدأ.
- filestore موجود؛ reservation/credential/classification/runtime-gate كلها موجودة، runtime-gate دائم (persistent) بلا `runtime-gate-history` (البوابة `complete()` لم تُستدعَ قط).
- الـ worker خرج بـ exit 1 — **fail-stop مقصود بالتصميم** (`job-loop.ts:3`، `job-worker.ts:242-245`)، وليس خطأ unhandled-rejection.

## السبب الجذري المؤكَد من المصدر
- **عدم توافق مؤكَد من المصدر:** الكتالوج المُثبَّت (`deploy/catalog/solutions/platform.json:14`) يغيب عنه `branches.extra_limit`، وهي مفتاح **مطلوب** في `nasq_platform` داخل صورة odoo الفعلية (`feature_registry.py:30-34`، والتحقق المطلوب `entitlement_service.py:404-431` مع raise للمفاتيح الناقصة). هذا سبب متسق مع مرحلة الفشل، لكن:
- **الاستثناء التاريخي الدقيق ضائع — لا يجوز الادعاء بأسر `ValidationError`:** الـ shell تدمّر بـ `--rm`، وstderr مُسقط في المحوّل، و`odoo_effect.py:438-441` يحجب تفاصيل الخطأ عمدًا. يبقى غير قابل للاسترجاع من الأدلة الحالية (موثق في `provision-diagnosis.json` → `rootCause.exactUnderlyingShellError` و`reviewCorrection`).

## قواعد الحفظ (إلزامية)
- **حافظ على كل شيء كما هو:** قاعدة بيانات المستأجر، filestore، runtime-gate، reservation، credential، classification — بلا حذف، بلا replay عمياء، بلا إيصالات مختلقة.
- توصية المراجعة المستقلة للقراءة فقط: **إصدار كتالوج/سياسة جديد غير قابل للتعديل (immutable) يحافظ على الـ digests القديمة**، وبروتوكول استرجاع مرحلي (staged recovery) **مُراجَع بشكل منفصل** ويعمله المشغّل — لا شيء في هذه الوثيقة يخوّل استرجاعًا ذاتيًا.

## فجوات مصدرية إضافية (SOURCE-ONLY، مُثبتة من الكود، غير مُصلَحة)
كلها ملاحظات من المصدر خلال الاستئناف، بلا أي تعديل:
1. `cancelOrder` غير موجَّهة (unrouted) — ولا يوجد حماية ضد إلغاء أوامر غير معروفة/بلا مرجع (`apps/control-plane/src/commercial/orders.ts`).
2. مقاييس الاستخدام الحقيقية موجودة في `subscription_effect` لكن `recordUsage` غير مُستدعاة (`apps/control-plane/src/commercial/usage.ts`).
3. بدء المُجدول يغيب عنه `subscriptionRunner` (`apps/control-plane/src/commercial/scheduler.ts`).
4. `recoverSharedJob` بلا مسار HTTP/CLI، ومحجوبة بالبوابة الدائمة (persistent gate) (`apps/control-plane/src/shared/job-worker.ts` + `provision-diagnosis.json` → `recoveryGap`).

## محاولات الوصفة الإلزامية
- محاولات تشغيل الوصفة **فشلت في الإعداد (setup)**: أعاد الوكيل `null` — لم تكن تنفيذًا ناجحًا للتوصيف، وشُخّصت منفصلة. لا يجوز تسجيلها كنجاح أي طبقة.
- **تعديلات سياسة جزئية نزلت فعليًا أثناء تنفيذ الوصفة الفاشل، مع كتابات غير متوقعة أثناء setup المفترض read-only** (unexpected writes) — حالتها WIP داخل الشجرة، محتواها محصور وموثق، وليست تنفيذًا مكتملًا ولا مقبولًا. مسببات التكافؤ (parity probes) أُصلحت بعد تلك الكتابات، ثم **أُعيد تحقق مستقل: TypeScript 23/23 وPython 54/54 والبناء (build) PASS**، مع بقاء **فجوة no-core المشتركة** و**مراجعة شاملة (comprehensive review) عالقة** — غير مُغلَقة. احتواء الكتابات غير المتوقعة: نطاقها محصور في ملفات السياسة الجزئية داخل الشجرة، ولا يُعدّ أي منها دليل قبول (المالك: منسّق التكامل).
- **إعادة ضبط إعدادات الوكيل فقط (settings-only) إلى GLM light:** نُفِّذت ومكتملة (بعد تفويض من المستخدم). إعادة توجيه المتابعة إلى **Codex** قيد الانتظار عبر مهمة جديدة (fresh task). أحدث محاولة وصفة ما زالت تعيد تشخيص setup=null — قيد التشخيص، غير محلولة.

## حالة E15/E04/التوابع
- **E15 vendor44:** صفحات ar/en على **390/1440 فقط** (ليست 768) نجحت **PARTIAL** — مصفوفة الحالات الكاملة (empty/error/forbidden/loading) غير مكتملة. الدليل: `E15.json` (`result: BLOCKED`، `exit_code: 0` لاختبار الصفحات فقط) و`E15.history.jsonl`.
- **E04 FAIL وما بعده BLOCKED:** E05–E14 وE16 غير قابلة للتنفيذ (BLOCKED) في `report.md`؛ لا يوجد قبول متفرعات حقيقي (real-branches) كامل حتى الآن.
- **E06 PASS المبكر في `live-20261006-acceptance` كان PASS اقتباس/تسعير فقط (quote-only)** — لا يجوز الاستشهاد به أبدًا كقبول فروع حقيقية كامل (موثق في تقرير `saas-commercial-integrated-acceptance.md`، مقطع `live-20261006`).

## التوقيت والأدلة الزمنية
- معرّف run يحمل `20261007` هو **معرّف فقط، لا دليل ساعة**: الأوقات المسجلة فعليًا في ملفات الأدلة UTC بتاريخ **2026-10-03** (مثل `E04.at = 2026-10-03T02:28:30Z`، `generatedAt = 2026-10-03T02:40:00Z`، حسب mtimes الفعلية للملفات 3 Oct).
- وقت الاستمرار الحالي (continuation) **لم يُسجَّل بشكل منفصل** — لا تاريخ مختلق من run-id.

## كيفية التشغيل والتحقق (القراءة فقط)
الأوامر المدعومة للقراءة فقط بعد قراءة `tools/saas_commercial_acceptance/README.md` (فحص صحة/سجل عبر lifecycle؛ لا تدخل/كتابة/إعادة تشغيل):

```bash
cd /Users/tariq/.codex/worktrees/saas-commercial/nasq
L=tools/saas_commercial_acceptance/commercial_lifecycle.py
python3 $L state
python3 $L compose ps
# سجلات عامل التشغيل (قراءة فقط عبر lifecycle):
python3 $L compose logs control-worker
```

أمر الاستئناف المرجعي بعد استرجاع المشغّل المُراجَع فقط — **DO NOT RUN قبل استرجاع المشغّل المُراجَع**:

```bash
# DO NOT RUN قبل استرجاع المشغّل المُراجَع — يحمل فشل التزويد نفسه
NASQ_SCA_RUN_ID=<run-id-jadid> npx playwright test --config tools/saas_commercial_acceptance/playwright.config.mjs
```

## ما تبقى (أصحاب ومعايير إنجاز)
- **استرجاع التزويد Baa مرحلي (staged) مُراجَع بقيادة المشغّل** (بوابة whitelisted error codes، دليل مرحلي محفوظ) — المالك: المشغّل + منسّق التكامل — المعيار: حالة الوظيفة تتجاوز `needs_intervention` دون حذف أي أثر محفوظ.
- **إصدار كتالوج/سياسة immutable جديد** مع الحفاظ على digests الإصدارات القديمة، مُراجَع منفصلًا — المالك: فريق الكتالوج — المعيار: `branches.extra_limit` موجود في النسخة الجديدة (بقيمة السعة المعتمدة)، والقديمة سليمة.
- **فجوة no-core المشتركة + المراجعة الشاملة (comprehensive review)** — المالك: منسّق التنفيذ — المعيار: فجوة موثقة ومغلقة ومراجعة شاملة تمرّ قبل أي إصدار كتالوج.
- **فجوات المصدر الأربعة أعلاه** — المالك: منسّق التنفيذ بعد القرار — المعيار: إصلاح + اختبارات لكل بند، لا ضمن هذا الاستئناف.
- **إعادة تشغيل E04 ثم E05–E14/E16/E13/E15 كاملة** — المالك: منسّق القبول — المعيار: كل صف PASS بقراءة readback من الخدمة المالكة في run-id جديد (لا تعديل run قديم).

## المخاطر
- **البوابة الدائمة تحجب أي وظائف مستأجر جديدة** (`job-store.ts:133` يمنع وظائف جديدة وجود وظيفة `needs_intervention`) — الأثر: توقف مسار المستأجر كاملًا — التخفيف: بروتوكول الاسترجاع المُراجَع فقط.
- **الفجوات المصدرية الأربع غير مُصلَحة** — الأثر: قبول حقيقي لاحق سيفشل أو يعطي قياسات استخدام ناقصة — التخفيف: تضمينها في نطاق تنفيذ مُحصَّل بعد القرار.
- **عيوب التكافؤ: مسببات التكافؤ أُصلحت بعد كتابات setup غير متوقعة، وإعادة تحقق مستقل TS 23/23 وPython 54/54 والبناء PASS؛ فجوة no-core المشتركة والمراجعة الشاملة عالقة** — الأثر: سلوك مختلف محتمل بين المسارين — التخفيف: إغلاق الفجوة والمراجعة الشاملة قبل أي إصدار كتالوج immutable.
- **الكتابات غير المتوقعة أثناء setup المفترض read-only (WIP)** — الأثر: خلط نطاق القراءة فقط مع تعديل فعلي — التخفيف: احتواء موثق ومراجعة نطاق قبل أي إعادة تشغيل للوصفة.
- **إعادة توجيه المتابعة إلى Codex غير منجزة بعد** — الأثر: توقف حلقة التشخيص على setup=null — التخفيف: مهمة Codex جديدة (fresh task) بعد اكتمال التشخيص.
- **التشابه الزمني (run-id 20261007 مقابل UTC 2026-10-03)** — الأثر: قراءة خاطئة للتسلسل الزمني — التخفيف: الاعتماد على أوقات الملفات الفعلية فقط.

## القرارات
- **الحفظ المطلق بدل أي تنظيف** — البديل المرفوض: حذف DB/filestore/gate أو replay عمياء — السبب: منع المستخدم الصريح، ولا يوجد تدفق retirement مدعوم.
- **قرار المستخدم المعتمد لمسار الاسترجاع:** البدء من الحالة المرصودة الحالية (observed `policy_revision = 0`) مع اختيار **قيمة سعة أولية `branches.extra_limit = 0`** في الكتالوج الجديد — وهما أمران مختلفان: الأولى حالة دالة موجودة، والثانية قرار سعة معتمد — + **إصدار مصدر/واصف كتالوج جديد immutable** (يحافظ على digests القديمة) + **بروتوكول staged recovery مرحلي مُراجَع بشكل منفصل مع الحفاظ على كل الحالة** — البديل المرفوض: إعادة محاولة على السياسة القديمة الناقصة أو حذف الحالة المحفوظة — السبب: عدم توافق المصدر المؤكد وغياب تدفق retirement مدعوم.
- **كتابة حالة استئناف مؤقتة لا إغلاقًا** — البديل المرفوض: وثيقة إغلاق — السبب: E04 FAIL والبوابة محظورة، والإغلاق يتطلب قبولًا حيًا كاملًا.
- **الإشارة بالمسارات فقط لمواقع runtime وsecret-env المعزولة** — البديل المرفوض: نقل أي قيم — السبب: الأسرار حمراء دائمًا؛ المواقع: scope التشغيل = compose project `nasq-saas-commercial-acceptance`، state dir = `tools/saas_commercial_acceptance/.state/nasq-saas-commercial-acceptance`، دليل الأدلة = `tools/saas_commercial_acceptance/.evidence/live-20261007-acceptance/`، متغيرات secret env للمشغل تُمرَّر عبر قنوات المشغّل (قيمها غير مقروءة: `valueNotRead: true` في التشخيص). قيود الأدلة: الدفع SIMULATED، Mailpit محلي، الدليل المحلي لا يثبت جاهزية إنتاج.

## جهات الاتصال ومسارات الملفات
- مالك هذا الملف: مهمة استئناف `codex/saas-commercial` (docs-only).
- تشخيص التزويد: `tools/saas_commercial_acceptance/.evidence/live-20261007-acceptance/provision-diagnosis.json`.
- تقرير التشغيل: `tools/saas_commercial_acceptance/.evidence/live-20261007-acceptance/report.md` + `run-header.json`.
- القبول المتكامل: `docs/verification/saas-commercial-integrated-acceptance.md`؛ الأجزاء: `saas-commercial-a.md`، `saas-commercial-b.md`.
- دليل التشغيل المعزول: `tools/saas_commercial_acceptance/README.md`.
