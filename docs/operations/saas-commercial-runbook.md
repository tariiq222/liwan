# دليل تشغيل ويب فيو SaaS التجاري

التاريخ: 2026-10-02. الحالة: **مسودة تشغيل، لا إعلان جاهزية.** الدليل مبني على الشيفرة الموجودة في الـworktree `codex/saas-commercial` (غير ملتزمة). الأقسام التي تشير إلى شيفرة لم تكتمل (مسارات webhook والتجديد والمصالحة وصفحات العمليات التجارية، أي B2/B4 وC2) **ستؤكَّد أو تُصحَّح بعد اكتمال C2**؛ لا تُنفَّذ خطواتها في بيئة حقيقية قبل ذلك.

## مفتاح حالة التحقق

| الوسم | المعنى |
|---|---|
| **[محلي]** | له دليل تشغيل أو اختبار محلي/scratch؛ لا يثبت إنتاجًا |
| **[غير مختبر]** | مكتوب من قراءة الشيفرة/المخطط فقط؛ لم يُشغَّل |
| **[بعد C2]** | يعتمد على شيفرة لم تكتمل؛ يؤكَّد بعد C2 |
| **[محجوب]** | يحتاج بيئة أو مفاتيح غير متوفرة (staging، Moyasar، SMTP) |

لا يقدّم هذا الدليل أي وعد SLA أو RPO/RTO؛ أهداف السعة وSLA مفتوحة (انظر `docs/verification/saas-commercial-staging.md`).

## 1. المكوّنات

| المكوّن | الدور | ملاحظات |
|---|---|---|
| `control-api` | واجهة التحكم (`apps/control-plane/src/http.ts` و`commercial/http.ts` تحت `/v1/commercial`) | مصدر الاتفاق التجاري والأسعار والإصدارات؛ طلبات الواجهة موقّعة عبر BFF |
| `control-worker` | تنفيذ المهام (`src/worker-main.ts`، و`worker:shared` للمشترك `shared-worker-main.ts`) | تجهيز، نسخ/استعادة، reconfigure؛ lease محلي لمضيف واحد |
| `commercial_outbox` | جدول أحداث خارجة (`schema_013.sql`): `kind, aggregate_id, dedupe_key, status ∈ pending/done/failed` | فريد على (kind, aggregate_id, dedupe_key) لمنع التكرار |
| reconfigure jobs | مهام تغيير الخدمة بعد الاتفاق/الدفع (`shared/job-*`)، وأثرها في `fulfillment_effects` (إيصال، `observed_digest`) | لا يُعلن «applied» قبل readback من Odoo |
| محوّل Moyasar | `commercial/moyasar-adapter.ts`: فاتورة مستضافة + redirect، webhook، token، استرداد | الـwebhook يحمل `secret_token` مشتركًا (بلا HMAC)؛ يُعاد فحص الحالة من المزود قبل الاعتماد |
| محوّل البريد | `commercial/mail-adapter.ts`: SMTP لدعوة المسؤول | رموز الدعوة في `invitation-tokens.ts` |
| محاكي الدفع | `commercial/payment-simulator.ts` | **للاختبار فقط**؛ يرفض الإنتاج و`MOYASAR_MODE=live`. ليس دليل دفع حقيقي |
| مساحات Odoo | قاعدة وfilestore لكل عميل خلف Odoo مشترك | العزل database-per-tenant |

جداول الحالة الأساسية: `orders` (`payment_state`: not_required/awaiting_payment/paid/failed/refund_pending/refunded؛ `fulfillment_state`: not_started/queued/applying/applied/failed/needs_intervention)، `invoices` (draft/issued/paid/void/credit_pending)، `payment_attempts` (created/redirected/pending/succeeded/failed/canceled/unknown)، `payment_events`، `subscriptions` (pending/trialing/active/past_due/suspended/cancelled)، `renewals` (invoiced/charging/paid/past_due/suspended/failed)، `commercial_branches`، `usage_snapshots` (fresh/stale/unavailable)، `legacy_mappings`، `migration_runs`.

## 2. الإعداد (أسماء المتغيرات فقط — لا قيم في هذا الملف)

تُحقن عبر بيئة العملية/مدير أسرار، ولا تُسجَّل ولا تُمرَّر في سطر الأوامر. المحوّل يرفض التشغيل عند نقص أي متغير مطلوب (`provider_not_configured` / `mail_not_configured`).

| المتغير | الاستخدام |
|---|---|
| `WEBVUE_PAYMENT_PROVIDER` | `moyasar` أو `simulator` (غيرها يرفض) |
| `MOYASAR_MODE` | `test` أو `live` فقط؛ `live` يُستخدم بعد تفويض إنتاج صريح |
| `MOYASAR_SECRET_KEY` | مفتاح API (سر) |
| `MOYASAR_WEBHOOK_SECRET` | سر الـwebhook (`secret_token`) (سر) |
| `MOYASAR_ACCOUNT_NAME` | اسم حساب التاجر؛ أي webhook بحساب آخر يُرفض (`merchant_mismatch`) |
| `WEBVUE_PAYMENT_RETURN_ORIGINS` | قائمة origins مسموحة لعودة الدفع مفصولة بفواصل |
| `WEBVUE_MAIL_MODE` | الافتراضي `smtp`؛ غيره يرفض |
| `WEBVUE_MAIL_SMTP_HOST`, `WEBVUE_MAIL_SMTP_PORT`, `WEBVUE_MAIL_FROM` | وجهة الإرسال والمرسِل |
| `WEBVUE_MAIL_REQUIRE_TLS` | إلزام TLS |
| `WEBVUE_MAIL_SMTP_USER`, `WEBVUE_MAIL_SMTP_PASSWORD` | اعتماد SMTP اختياري (سر) |

غير متوفر حاليًا: مفاتيح Moyasar للاختبار وإعدادات SMTP **[محجوب]**. مفاتيح الإنتاج لا تُستخدم في اختبار محلي أبدًا.

## 3. حسابات لوحة تحكم ويب فيو

الصلاحيات مشتقة من أدوار الحساب (`owner` وغيره)؛ لم يعد هناك منح أو إلغاء يدوي بمعرّف Odoo (أُزيل الأمران `grant` و`revoke`). الأوامر أدناه تتطلب ضبط `ADMIN_SECRET_KEY` و`ADMIN_RP_ID` و`ADMIN_ORIGIN`؛ وبدونها ترفض التنفيذ.

أول مالك للوحة (من خادم التشغيل، من `apps/control-plane`؛ يشغّل `migrate` أولًا ويكتب `audit_events` بالفاعل `operator`):

```sh
npm -w apps/control-plane run admin -- bootstrap-owner <email> "<الاسم الظاهر>" "<سبب 3-1000 حرف>"
```

يطبع سطرًا واحدًا فقط: `<ADMIN_ORIGIN>/enroll#<token>`، وهو رابط يفتح في تطبيق `apps/vendor-admin` على مضيف `admin` (الرمز بعد `#` لا يصل إلى الخادم ولا إلى السجلات). يرفض الأمر مع الرسالة `owner already exists` إذا وُجد أي حساب غير معطّل (نشط أو قيد التسجيل) يحمل دور المالك.

إعادة تعيين مالك مقفل خارج حسابه (أو أي حساب غير معطّل):

```sh
npm -w apps/control-plane run admin -- reset-account <email> "<سبب 3-1000 حرف>"
```

يطبع رابط إعادة تعيين بالصيغة نفسها؛ بريد غير معروف أو حساب معطّل يعيد خطأً عامًا بلا تفصيل.

- الرابط يُرسل يدويًا إلى صاحب الحساب عبر قناة موثوقة، وينتهي بعد 24 ساعة، ويُستعمل مرة واحدة.
- الرابط يظهر مرة واحدة فقط في الطرفية: لا تلصقه في أدوات الدردشة أو التذاكر أو السجلات. إن ضاع فأصدر رابطًا جديدًا (الإصدار الجديد يلغي القديم).
- لا تضع كلمة مرور أو مفتاحًا في سطر الأوامر. **[محلي]** السلوك مختبر على قاعدة scratch فقط؛ لم يُشغَّل أمام staging.

### تشغيل لوحة التحكم محليًا (`apps/vendor-admin`)

1. جهّز لوحة التحكم (`apps/control-plane`) بقاعدة scratch ومنفذ حر، وأضف إلى بيئتها: `ADMIN_SECRET_KEY` (32 بايت على الأقل، ومختلف عن كل مفتاح خدمة) و`ADMIN_RP_ID=localhost` و`ADMIN_ORIGIN=http://localhost:3100`.
2. أنشئ المالك الأول بالأمر `bootstrap-owner` أعلاه، واحتفظ بالرابط المطبوع (يظهر مرة واحدة).
3. شغّل التطبيق من جذر المستودع (Node 22):

```sh
export NUXT_CONTROL_URL=http://127.0.0.1:<منفذ لوحة التحكم>
export NUXT_SERVICE_KEY=<قيمة CONTROL_SERVICE_KEY نفسها>
export NUXT_INSTALLATION_ID=<قيمة CONTROL_INSTALLATION_ID نفسها>
export NUXT_ADMIN_ORIGIN=http://localhost:3100
npm -w apps/vendor-admin run dev -- --port 3100
```

4. افتح الرابط المطبوع (`http://localhost:3100/enroll#...`) في المتصفح، وأكمل تسجيل مفتاح المرور (passkey) وكلمة المرور ورمز TOTP، واحفظ رموز الاسترداد.
5. على خادم الإنتاج يُخدَّم التطبيق من مضيف `admin` المستقل (قالب البيئة `deploy/vendor-admin/env.example` وكتلة الحافة `deploy/vendor-admin/Caddyfile.snippet`)، و`ADMIN_ORIGIN` في لوحة التحكم يساوي `NUXT_ADMIN_ORIGIN` حرفيًا. **[محلي]** لم يُجرَّب أمام staging.

شرح المتغيرات وحدود التطبيق في `apps/vendor-admin/README.md`.

أوامر admin أخرى: `catalog-import <version> <reason>`، `approve-restore <tenant_uuid> <op_backup_id> <reason>` (موافقة ساعة واحدة)، `migrate-saas-commercial --dry-run|--run [--report path]`.

## 4. إجراءات التشغيل

> كل إجراء يبدأ بالقراءة فقط. لا تعدّل جداول مباشرة؛ الحالة المالية لها triggers تمنع التراجع (مثل `order_payment_regression`).

### 4.1 طلب عالق: مدفوع ولم يُطبَّق [بعد C2] [غير مختبر]

1. حدّد الطلب: `orders` حيث `payment_state='paid'` و`fulfillment_state` ليس `applied`.
2. اقرأ `fulfillment_effects` للطلب: `job_id`، `operation_id`، `receipt`، `observed_digest`، `applied_at`.
3. اقرأ المهمة في طابور العمليات وسجل `audit_events`، وأحداث `commercial_outbox` للطلب (`pending/failed`).
4. التشخيص:

| الحالة | المعنى | الإجراء |
|---|---|---|
| `queued`/`applying` ومهمة حية | قيد التنفيذ | انتظر؛ راقب انتهاء lease |
| `applying` ومهمة منتهية/lease منقضٍ | عامل توقف | أعد تشغيل العامل؛ الاستئناف يعتمد observation لا إعادة تنفيذ أعمى |
| `failed` | فشل التنفيذ | اقرأ الخطأ؛ أعد المحاولة من واجهة العمليات (`vendor.operations.run`) بعد إصلاح السبب |
| `needs_intervention` | يحتاج قرارًا | لا تُعلن نجاحًا؛ تحقق من Odoo يدويًا (readback)، ثم أعد أو عوّض الدفع حسب السياسة |
| `applied` لكن الاشتراك لا يعكس | عدم اتساق | قارن `observed_digest` بحالة Odoo؛ افتح حادثة |

5. لا تصل بالاشتراك إلى «active» ولا تحصّل مرة ثانية؛ الاسترداد لا يتم تلقائيًا (قرار معتمد: لا استرداد تلقائي).

### 4.2 رفض webhook الدفع [بعد C2] [غير مختبر]

أسباب الرفض في `moyasar-adapter.ts`: `signature_invalid` (سر خاطئ)، `merchant_mismatch`، `mode_mismatch` (live/test)، `invalid_event` (JSON/نوع غير معروف).

1. اقرأ رمز الرفض من سجل `control-api` (الأسرار تُنقَّح من الرسائل).
2. `signature_invalid`: تحقق أن `MOYASAR_WEBHOOK_SECRET` يطابق إعداد لوحة المزود؛ لا تطبع السر. بعد التدوير أعد تشغيل `control-api`.
3. `merchant_mismatch`/`mode_mismatch`: تحقق `MOYASAR_ACCOUNT_NAME` و`MOYASAR_MODE` مقابل البيئة؛ حدث test لا يقبل في live والعكس. هذه إشارة تهيئة خاطئة أو محاولة تزوير؛ لا تُخفّف التحقق.
4. بعد الإصلاح لا تعيد إرسال الأحداث يدويًا قبل مصالحة المحاولة (4.3)؛ الحالة تُحسم بإعادة الفحص من المزود وليس بمحتوى webhook وحده.

### 4.3 مصالحة محاولات دفع مجهولة [بعد C2] [غير مختبر]

`payment_attempts.status='unknown'` يحجز المحاولة الحية (فهرس `payment_attempts_one_live`) ويمنع محاولة جديدة للطلب نفسه.

1. اسرد المحاولات `unknown`/`pending` الأقدم من المهلة.
2. لكل محاولة اقرأ حالة الفاتورة/الدفعة من Moyasar مباشرة (بمفتاح البيئة الصحيح) واربطها بـ`metadata.attempt_id` و`order_id`.
3. المزود `paid` ← سجّل `payment_events` ثم تابع التجهيز (4.1)؛ `failed/canceled` ← حدّث المحاولة ليُسمح بمحاولة جديدة؛ لا يُعاد التحصيل قبل هذا الحسم.
4. تحقق عدم وجود فاتورة ثانية للفترة نفسها (`renewals` فريد على subscription/period_start/kind).
5. ملاحظة: مسار المصالحة المؤتمت **ليس مكتملًا بعد**؛ هذه خطوات يدوية مقترحة.

### 4.4 تشغيل التجديد [بعد C2] [غير مختبر]

- التجديد يصدر فاتورة واحدة للفترة (`renewals` فريد)، ثم `charging` عبر token المزود إن وُجدت موافقة صريحة، وإلا طلب دفع.
- قبل أي تشغيل جماعي: تحقق الساعة، وأن المزود في الوضع الصحيح، وعدم وجود `renewals` عالقة بـ`charging`.
- تتبّع الحالات: `invoiced → charging → paid | past_due | suspended | failed`. لا يُعاد تشغيل التجديد لفترة سبق إصدار فاتورتها.
- مكان تشغيل المجدول/الأمر **غير محسوم بعد في الشيفرة**؛ يُحدَّد بعد C2.

### 4.5 past_due والتعليق وفق سياسة الباقة [بعد C2] [غير مختبر]

- قرار معتمد: `trial_days` و`grace_days` صريحان لكل باقة؛ التعليق الآلي بحسب سياسة الباقة فقط، ولا قيم ثابتة.
- `past_due`: في مهلة السماح؛ الخدمة تعمل. بعد انتهائها `suspended`. تحقق السياسة المنشورة للباقة (الإصدار المحفوظ للاشتراك) لا السعر العام.
- لا حذف بيانات عند التعليق/الإلغاء؛ الاستئناف بعد الدفع يتطلب تحقق Odoo قبل إعلان الفعالية.
- لا تعلّق يدويًا خارج السياسة؛ استثناء يحتاج قرارًا مسجلًا في `audit_events`.

### 4.6 استعادة ثم مصالحة الاستحقاق التجاري قبل الفتح [محلي جزئيًا]

- **[محلي]** نسخ/استعادة Odoo الحقيقيين (قاعدة + filestore) لعميلين وعزلهما: `docs/verification/shared-restore-acceptance.md` (2026-10-01، scratch فقط). أداة التشغيل: `tools/shared_saas_lifecycle` (انظر README)؛ الموافقة عبر `admin approve-restore`.
- **[بعد C2] [غير مختبر]** المصالحة التجارية بعد الاستعادة: نسخة أقدم قد تُعيد features/branch IDs قديمة. قبل فتح المساحة: قارن الاستحقاقات الفعلية (تطبيقات، حدود، فروع) مع الاشتراك الحالي؛ فرع مدفوع أُضيف بعد النسخة يوضع في reconciliation ولا يُفوتَر مرتين ولا يُنشأ فرع وهمي؛ لا تتراجع حقوق مدفوعة بصمت.
- لا تُفتح المساحة المستعادة للعميل قبل نجاح المصالحة وتسجيل نتيجتها.
- أثر النسخ على بقية العملاء: النسخ المحلي قد يوقف Odoo المشترك لفترة قصيرة؛ غير مقاس على staging **[محجوب]**.

### 4.7 ترحيل العملاء القدامى (dry-run ثم run) [محلي جزئيًا]

```sh
npm -w apps/control-plane run admin -- migrate-saas-commercial --dry-run --report /abs/path/dry.json
npm -w apps/control-plane run admin -- migrate-saas-commercial --run --report /abs/path/run.json
```

- dry-run لا يعدّل بيانات؛ يصنّف (saas_package / saas_catalog_only / saas_commercial / non_saas) ويعدّ الأخطاء لكل صف ويخرج `source_digest`. الخروج 2 إذا وُجدت أخطاء صفوف.
- `saas_commercial`: مستأجر يملكه المسار التجاري (عميل غير قديم سجّله أو له اشتراك عليه). يُتخطّى ولا يُكتب له شيء، وتظهر معرفاته في `skipped_commercial`. عميل مربوط بلا اشتراك ولا تسجيل يبقى `customer_conflict`، ووجود العميل القديم مع عميل تجاري معًا `ownership_conflict`.
- شرط: نسخة احتياطية/قاعدة scratch أولًا؛ راجع `errors` وعدّاد كل فئة قبل `--run`.
- القاعدة: عميل بلا سعر مسجل يبقى على سياسته الحالية ويوسم «يحتاج إعداد اتفاق تجاري»؛ لا فاتورة صفرية ولا دين ولا سعر مخترع. إعادة التشغيل تعطي نفس النتيجة (idempotent بمعرف uuidv5 ثابت).
- **[بعد C2]** إثبات الاستئناف بعد انقطاع وتطابق counts/hashes على نسخة scratch يتبع C1/C2؛ لم يُعد قبوله في هذا الدليل. الأعمدة القديمة لا تُسقط في التسليم الأول.

## 5. التنبيهات والإجراء لكل منها

**المراقبة غير مُنفَّذة.** الجدول يحدد المطلوب بناؤه؛ لا يوجد حاليًا مُصدِّر مقاييس أو قواعد تنبيه، ولا مسؤول مُسمّى (يُحدَّد قبل الإطلاق).

| التنبيه | الإشارة | الإجراء الأول | الإجراء اللاحق |
|---|---|---|---|
| رفض webhook الدفع | ارتفاع رموز `signature_invalid/merchant_mismatch/mode_mismatch` | 4.2: تحقق الأسرار/الحساب/الوضع | إن كان تزويرًا: حافظ على الرفض وراجع المصدر |
| فحص تكرار الفاتورة | أكثر من فاتورة للاشتراك/الفترة/النوع، أو دفعتان ناجحتان لطلب واحد | أوقف التجديد الجماعي؛ افحص `renewals` و`payment_events` | تسوية عبر `invoice_adjustments` (لا تعدّل الفاتورة)، قرار رد يدوي |
| تجهيز متعثر | طلب `paid` بلا `applied` بعد مهلة، أو مهمة بلا تقدّم/lease منتهٍ | 4.1 | تصعيد `needs_intervention` |
| عدم تطابق desired/observed | `observed_digest` ≠ مقصود الاتفاق، أو فروع/حدود Odoo تخالف الاشتراك | قارن readback بإصدار الاشتراك | أعد reconfigure؛ لا تعلن النجاح قبل التطابق |
| تقادم الاستخدام | `usage_snapshots.freshness` = `stale/unavailable` لأكثر من المهلة | تحقق وصول العامل إلى Odoo | لا تفرض حدودًا/فوترة اعتمادًا على قراءة قديمة بلا قرار |
| فشل تسليم الدعوة | فشل SMTP/ارتداد/دعوة غير مفتوحة | تحقق `WEBVUE_MAIL_*` وTLS | أعد إرسال دعوة جديدة (رموز الدعوة محدودة)؛ لا تُرسل كلمة مرور مباشرة |
| عمر النسخة الاحتياطية | آخر نسخة ناجحة أقدم من الهدف، أو فشل restore | شغّل نسخة؛ افحص مساحة/مضيف خارجي | RPO غير معتمد؛ لا وعد SLA قبل قرار |

حدود العتبات (المهل، الأعمار) **مفتوحة** حتى اعتماد أهداف السعة وSLA.

## 6. ما لم يُتحقق منه

- لا بيئة staging، لا نطاقات/TLS حقيقية، لا مفاتيح Moyasar sandbox، لا SMTP؛ كل إجراء دفع/بريد أعلاه نظري **[محجوب]**.
- الاختبارات المحلية لا تثبت الدفع الحقيقي أو السعة أو الإنتاج؛ لا commit/merge/deploy مأذون.
- فاتورة ZATCA الرسمية خارج النطاق؛ الضريبة 15% حصرية كبند مستقل، وتحتاج مراجعة تاجر/قانونية.
- الأقسام الموسومة **[بعد C2]** تُراجع ويُحدَّث هذا الملف بعد اكتمال C2 قبل الاعتماد عليها.
