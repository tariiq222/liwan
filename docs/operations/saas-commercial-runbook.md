# دليل تشغيل ليوان SaaS التجاري

آخر تحديث: 2026-10-22. الحالة: **مسودة تشغيل جزئية، لا إعلان جاهزية.** بدأ هذا الدليل كمسودة في 2026-10-02 اعتمادًا على worktree `codex/saas-commercial`. الشيفرة الحالية تتضمن مسارات webhook والدفع والتجديد والمصالحة، ومجدولًا في العامل المشترك، وواجهة عمليات تجارية. هذا يثبت وجود مسارات في المصدر فقط؛ لا يثبت قبول إجراءات هذا الدليل أو تشغيل العامل في staging أو production. تبقى كل خطوة موسومة بقبول تشغيلي غير متحقق خارج نطاق التنفيذ حتى يُنجز قبولها في البيئة المقصودة.

## مفتاح حالة التحقق

| الوسم | المعنى |
|---|---|
| **[محلي]** | له دليل تشغيل أو اختبار محلي/scratch؛ لا يثبت إنتاجًا |
| **[غير مختبر]** | الإجراء التشغيلي نفسه لم يُنفذ في البيئة المقصودة |
| **[قبول تشغيلي غير متحقق]** | مسار التنفيذ موجود في المصدر، لكن قبول الإجراء end-to-end لم يُثبت |
| **[محجوب]** | يتطلب بيئة أو مزودًا أو إعدادًا لم يُتحقق من توفره (مثل staging أو SMTP) |

لا يقدّم هذا الدليل أي وعد SLA أو RPO/RTO؛ أهداف السعة وSLA مفتوحة (القرارات المفتوحة في `docs/project-closure/saas-hosting-direction-status.md`).

## 1. المكوّنات

| المكوّن | الدور | ملاحظات |
|---|---|---|
| `control-api` | واجهة التحكم (`apps/control-plane/src/http.ts` و`commercial/http.ts` تحت `/v1/commercial`) | مصدر الاتفاق التجاري والأسعار والإصدارات؛ طلبات الواجهة موقّعة عبر BFF |
| `control-worker` | تنفيذ المهام (`src/worker-main.ts`، و`worker:shared` للمشترك `shared-worker-main.ts`) | في المصدر، `worker:shared` يهيئ المجدول التجاري ويستدعيه بعد دورات العامل؛ وجوده لا يثبت تشغيله في بيئة منشورة |
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
| `LIWAN_PAYMENT_PROVIDER` | `moyasar` أو `simulator` (غيرها يرفض) |
| `MOYASAR_MODE` | `test` أو `live` فقط؛ `live` يُستخدم بعد تفويض إنتاج صريح |
| `MOYASAR_SECRET_KEY` | مفتاح API (سر) |
| `MOYASAR_WEBHOOK_SECRET` | سر الـwebhook (`secret_token`) (سر) |
| `MOYASAR_ACCOUNT_NAME` | اسم حساب التاجر؛ أي webhook بحساب آخر يُرفض (`merchant_mismatch`) |
| `LIWAN_PAYMENT_RETURN_ORIGINS` | قائمة مسموحة لعودة الدفع مفصولة بفواصل. كل عنصر origin كامل (`https://app.example.com`) أو نمط `https://*.example.com` (مضيف واحد أو أكثر تحت اللاحقة، وللّاحقة تسمية واحدة على الأقل قبل النطاق الأعلى). في وضع dedicated يُستخدم أول عنصر فقط ولا يقبل النمط. في وضع shared (`LIWAN_TENANCY_MODE=shared`) تُبنى روابط عودة كل عميل من مضيف ربطه المفعّل في سجل المستأجرين، ويجب أن يطابق القائمة؛ عميل بلا ربط مفعّل أو بمضيف خارج القائمة يُرفض بـ`return_url_forbidden` (422) قبل أي كتابة |
| `LIWAN_MAIL_MODE` | الافتراضي `smtp`؛ غيره يرفض |
| `LIWAN_MAIL_SMTP_HOST`, `LIWAN_MAIL_SMTP_PORT`, `LIWAN_MAIL_FROM` | وجهة الإرسال والمرسِل |
| `LIWAN_MAIL_REQUIRE_TLS` | إلزام TLS |
| `LIWAN_MAIL_SMTP_USER`, `LIWAN_MAIL_SMTP_PASSWORD` | اعتماد SMTP اختياري (سر) |

يوثق [سجل قبول الاستضافة والتجارة، السطر 45](../project-closure/saas-hosting-direction-status.md) اتصالًا حقيقيًا بوضع Moyasar التجريبي في 2026-10-04 لإنشاء فاتورة وقراءتها ورفض مفاتيح الوضع الخاطئ 3/3. هذا لا يثبت توفر المفاتيح الآن أو اكتمال الدفع أو قبول webhook عبر HTTPS عام. توفر staging وSMTP لم يُتحقق منه في هذا التحديث **[محجوب]**. مفاتيح الإنتاج لا تُستخدم في اختبار محلي أبدًا.

## 3. حسابات لوحة تحكم ليوان

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

### 4.1 طلب عالق: مدفوع ولم يُطبَّق [قبول تشغيلي غير متحقق] [غير مختبر]

1. حدّد الطلب: `orders` حيث `payment_state='paid'` و`fulfillment_state` ليس `applied`.
2. اقرأ `fulfillment_effects` للطلب: `job_id`، `operation_id`، `receipt`، `observed_digest`، `applied_at`.
3. اقرأ المهمة في طابور العمليات وسجل `audit_events`، وأحداث `commercial_outbox` للطلب (`pending/failed`).
4. التشخيص:

| الحالة | المعنى | الإجراء |
|---|---|---|
| `queued`/`applying` ومهمة حية | قيد التنفيذ | انتظر؛ راقب انتهاء lease |
| `applying` ومهمة منتهية/lease منقضٍ | عامل توقف | أعد تشغيل العامل؛ الاستئناف يعتمد observation لا إعادة تنفيذ أعمى |
| `failed` | فشل التنفيذ نهائيًا بعد استنفاد المحاولات التلقائية أو لخطأ دائم | لا توجد إعادة محاولة يدوية من الواجهة. يوجد إشعار دائن `pending` على الفاتورة (`credit_pending`)؛ ارجع إلى «الاسترداد اليدوي» أدناه |
| `needs_intervention` | يحتاج قرارًا | لا تُعلن نجاحًا؛ تحقق من Odoo يدويًا (readback)، ثم أعد أو عوّض الدفع حسب السياسة |
| `applied` لكن الاشتراك لا يعكس | عدم اتساق | قارن `observed_digest` بحالة Odoo؛ افتح حادثة |

5. لا تصل بالاشتراك إلى «active» ولا تحصّل مرة ثانية؛ الاسترداد لا يتم تلقائيًا (قرار معتمد: لا استرداد تلقائي).

**المحاولات التلقائية.** صف `commercial_outbox` من نوع `fulfillment.enqueue` يُعاد تلقائيًا عند الأخطاء العابرة (`tenant_unavailable`، `shared_adapter_unavailable`، أخطاء قاعدة البيانات والشبكة، وأي خطأ غير معروف): حتى 10 محاولات، تأخير دقيقة يتضاعف حتى 60 دقيقة (نحو 4 ساعات). `attempts` و`next_attempt_at` يظهران في الصف والخطأ الأخير في `payload.error`. حالات الانتظار (`tenant_required`، `enrollment_pending`) لا تستهلك محاولات.

**النهاية.**
- خطأ دائم (`renewal_missing`، `order_not_found`، `enrollment_base_catalog_missing`، `enrollment_link_conflict`، `idempotency_conflict`، `shared_replay_forbidden`) أو استنفاد المحاولات: الطلب `failed`، والفاتورة `credit_pending`، وإشعار دائن `pending` واحد، والصف `failed`.
- `stale_target` و`observed_mismatch` و`provision_needs_intervention` (مهمة تجهيز المستأجر انتهت إلى `needs_intervention`): الطلب `needs_intervention` بلا إشعار دائن؛ المشغّل يعالج المهمة أو يقرأ Odoo ويقرر.
- إن فشلت معالجة الفشل نفسها (مثل استرداد وصل بين المحاولة والخطوة النهائية) يبقى الصف `pending` ويُسجَّل السبب في `payload.error` بالصيغة `failure_handling_failed: ...` وفي سجل `control-api`.
- `order_not_released` (الطلب مُسترد أو مُلغى): يُغلق الصف ولا يُمس الطلب؛ المال يعالجه `refund_pending`.

**الاسترداد اليدوي.** `payment.intervention` لا يُستهلك حاليًا، ولا استرداد تلقائي. يفتح المشغّل (دور `owner` أو `finance`، مع step-up حديث) صفحة الفاتورة `credit_pending` في وحدة التحكم، ويُرجع مبلغ الإشعار الدائن `pending` من لوحة مزود الدفع، ثم يضغط «تسجيل الاسترداد» ويُدخل مرجع الاسترداد عند المزود والسبب. يصبح الإشعار `refunded` مع المرجع والمسجِّل والوقت، ويُكتب حدث تدقيق `invoice.credit_refunded`. التسجيل لا يُحرّك مالًا، وتكراره بالمرجع نفسه يعيد النتيجة المسجَّلة دون صف تدقيق ثانٍ، ومرجع مختلف على إشعار مغلق يُرفض بـ`credit_note_not_pending` (409). تبقى حالة الفاتورة نفسها `credit_pending` (الفاتورة غير قابلة للتعديل)؛ الحالة الحاسمة هي حالة الإشعار. السياسة في [refund-policy.md](../finance/refund-policy.md).

### 4.2 رفض webhook الدفع [قبول تشغيلي غير متحقق] [غير مختبر]

أسباب الرفض في `moyasar-adapter.ts`: `signature_invalid` (سر خاطئ)، `merchant_mismatch`، `mode_mismatch` (live/test)، `invalid_event` (JSON/نوع غير معروف).

1. اقرأ رمز الرفض من سجل `control-api` (الأسرار تُنقَّح من الرسائل).
2. `signature_invalid`: تحقق أن `MOYASAR_WEBHOOK_SECRET` يطابق إعداد لوحة المزود؛ لا تطبع السر. بعد التدوير أعد تشغيل `control-api`.
3. `merchant_mismatch`/`mode_mismatch`: تحقق `MOYASAR_ACCOUNT_NAME` و`MOYASAR_MODE` مقابل البيئة؛ حدث test لا يقبل في live والعكس. هذه إشارة تهيئة خاطئة أو محاولة تزوير؛ لا تُخفّف التحقق.
4. بعد الإصلاح لا تعيد إرسال الأحداث يدويًا قبل مصالحة المحاولة (4.3)؛ الحالة تُحسم بإعادة الفحص من المزود وليس بمحتوى webhook وحده.

### 4.3 مصالحة محاولات الدفع غير المحسومة [قبول تشغيلي غير متحقق] [غير مختبر]

`payment_attempts.status='unknown'` يحجز المحاولة الحية (فهرس `payment_attempts_one_live`) ويمنع محاولة جديدة للطلب نفسه.

**انتهاء الفاتورة أو إلغاؤها عند المزود.** فاتورة الدفع المستضافة صالحة 30 دقيقة. حين يعيد المزود `expired` أو `canceled` أو `voided` تصبح المحاولة `canceled` ويبقى الطلب `awaiting_payment` (لم يُخصم شيء)، فيبدأ العميل محاولة جديدة على الطلب نفسه والفاتورة المُصدرة نفسها. محاولة حية أقدم من 30 دقيقة تُستعلم عند المزود قبل أن تُعاد للعميل، فتُغلق إن انتهت. أما الرفض (`failed`) فيجعل الطلب `failed` ولا يسمح بمحاولة جديدة، لكن دفعة ناجحة متأخرة تُقبل وفق آلة حالات الطلب.

1. افحص المحاولات `created`/`unknown`/`redirected`/`pending` وسجلات العامل للقراءة فقط.
2. في المصدر، يستدعي `worker:shared` المصالحة بعد عدد دورات يحدده `LIWAN_COMMERCIAL_RECONCILE_EVERY` (الافتراضي 10). تتطلب المصالحة مهايئ دفع مضبوطًا، وتعيد قراءة حالة المزود قبل حسم المحاولة.
3. لا تحدّث جداول المحاولات أو الأحداث يدويًا، ولا تعِد التحصيل عند نتيجة مجهولة. عند اختلاف الحالة أو تعذر قراءة المزود، أبقِ الطلب دون إعادة تحصيل وصعّد الحالة للمراجعة.
4. وجود المسار في المصدر واختباراته لا يثبت تشغيل العامل أو قبول المصالحة مع Moyasar في staging؛ لا تُنفذ إجراءً يدويًا بديلًا قبل توثيق نتيجة القبول.

### 4.4 تشغيل التجديد [قبول تشغيلي غير متحقق] [غير مختبر]

- التجديد يصدر فاتورة واحدة للفترة (`renewals` فريد)، ثم `charging` عبر token المزود إن وُجدت موافقة صريحة، وإلا طلب دفع.
- قبل أي تشغيل جماعي: تحقق الساعة، وأن المزود في الوضع الصحيح، وعدم وجود `renewals` عالقة بـ`charging`.
- تتبّع الحالات: `invoiced → charging → paid | past_due | suspended | failed`. لا يُعاد تشغيل التجديد لفترة سبق إصدار فاتورتها.
- في المصدر، `npm -w apps/control-plane run worker:shared` يشغّل `shared-worker-main.ts`، الذي يستدعي `createCommercialScheduler().tick()` بعد كل دورة للعامل. يشغّل مسار الفوترة كل `LIWAN_COMMERCIAL_BILLING_INTERVAL_SEC` ثانية (الافتراضي 3600)، ويُنشئ التجديدات فقط عند توفر مهايئ الدفع. هذه آلية مصدر، وليست دليلًا على أن عاملًا يعمل في staging أو production.
- يوجد أيضًا `POST /v1/commercial/renewals/run`؛ يتطلب `vendor.billing.manage` وتأكيد step-up حديثًا، ويرفض تمرير `now` في production. وجود المسار لا يجيز تشغيلًا يدويًا؛ لا يُستخدم قبل قبول الإجراء في بيئته المقصودة.

### 4.5 past_due والتعليق وفق سياسة الباقة [قبول تشغيلي غير متحقق] [غير مختبر]

- قرار معتمد: `trial_days` و`grace_days` صريحان لكل باقة؛ التعليق الآلي بحسب سياسة الباقة فقط، ولا قيم ثابتة.
- `past_due`: في مهلة السماح؛ الخدمة تعمل. بعد انتهائها `suspended`. تحقق السياسة المنشورة للباقة (الإصدار المحفوظ للاشتراك) لا السعر العام.
- لا حذف بيانات عند التعليق/الإلغاء؛ الاستئناف بعد الدفع يتطلب تحقق Odoo قبل إعلان الفعالية.
- لا تعلّق يدويًا خارج السياسة؛ استثناء يحتاج قرارًا مسجلًا في `audit_events`.

### 4.6 استعادة ثم مصالحة الاستحقاق التجاري قبل الفتح [قبول تشغيلي غير متحقق] [محلي جزئيًا]

- **[محلي]** نسخ/استعادة Odoo الحقيقيين (قاعدة + filestore) لعميلين وعزلهما: `docs/verification/shared-restore-acceptance.md` (2026-10-01، scratch فقط). أداة التشغيل: `tools/shared_saas_lifecycle` (انظر README)؛ الموافقة عبر `admin approve-restore`.
- **[غير مختبر] [قبول الاستعادة التجارية محجوب]** يحتوي المصدر على حاجز مصالحة `commercialRestoreGate`، لكن مهايئ Compose الافتراضي يوفّر رصد اشتراك/استخدام المستأجر المصدر فقط ولا يعلن `observeRestoreSubscription`؛ لذلك لا يملك المسار الافتراضي مراقبًا مستقلًا لهدف الاستعادة، وتبقى استعادة المستأجر ذي الاشتراك المطبق في `commercial_reconciliation_pending` حتى توفير مراقب ومنفذ لهدف معزول والتحقق منهما. راجع [دليل إصدارات النشر، السطر 234](../../deploy/releases/README.md). وجود الحاجز واختبارات PostgreSQL لمراجع الصلاحية والاصطفاف لا يثبت قبول استعادة تجارية فعلية أو جاهزية النشر؛ أما المستأجر القديم بلا اشتراك مطبق فلا يحتاج هذا الحاجز التجاري.
- لا تُفتح المساحة المستعادة للعميل قبل نجاح المصالحة وتسجيل نتيجتها؛ لا تُعدّل الاستحقاقات أو الفروع يدويًا لتجاوز الحاجز.
- أثر النسخ على بقية العملاء: النسخ المحلي قد يوقف Odoo المشترك لفترة قصيرة؛ غير مقاس على staging **[محجوب]**.

### 4.7 ترحيل العملاء القدامى (dry-run ثم run) [قبول تشغيلي غير متحقق] [محلي جزئيًا]

```sh
npm -w apps/control-plane run admin -- migrate-saas-commercial --dry-run --report /abs/path/dry.json
npm -w apps/control-plane run admin -- migrate-saas-commercial --run --report /abs/path/run.json
```

- dry-run لا يعدّل بيانات؛ يصنّف (saas_package / saas_catalog_only / saas_commercial / non_saas) ويعدّ الأخطاء لكل صف ويخرج `source_digest`. الخروج 2 إذا وُجدت أخطاء صفوف.
- `saas_commercial`: مستأجر يملكه المسار التجاري (عميل غير قديم سجّله أو له اشتراك عليه). يُتخطّى ولا يُكتب له شيء، وتظهر معرفاته في `skipped_commercial`. عميل مربوط بلا اشتراك ولا تسجيل يبقى `customer_conflict`، ووجود العميل القديم مع عميل تجاري معًا `ownership_conflict`.
- شرط: نسخة احتياطية/قاعدة scratch أولًا؛ راجع `errors` وعدّاد كل فئة قبل `--run`.
- القاعدة: عميل بلا سعر مسجل يبقى على سياسته الحالية ويوسم «يحتاج إعداد اتفاق تجاري»؛ لا فاتورة صفرية ولا دين ولا سعر مخترع. إعادة التشغيل تعطي نفس النتيجة (idempotent بمعرف uuidv5 ثابت).
- **[غير مختبر]** إثبات الاستئناف بعد انقطاع وتطابق counts/hashes على نسخة scratch لم يُعد قبوله في هذا الدليل. الأعمدة القديمة لا تُسقط في التسليم الأول.

## 5. التنبيهات والإجراء لكل منها

**المراقبة غير مُنفَّذة.** الجدول يحدد المطلوب بناؤه؛ لا يوجد حاليًا مُصدِّر مقاييس أو قواعد تنبيه، ولا مسؤول مُسمّى (يُحدَّد قبل الإطلاق).

| التنبيه | الإشارة | الإجراء الأول | الإجراء اللاحق |
|---|---|---|---|
| رفض webhook الدفع | ارتفاع رموز `signature_invalid/merchant_mismatch/mode_mismatch` | 4.2: تحقق الأسرار/الحساب/الوضع | إن كان تزويرًا: حافظ على الرفض وراجع المصدر |
| فحص تكرار الفاتورة | أكثر من فاتورة للاشتراك/الفترة/النوع، أو دفعتان ناجحتان لطلب واحد | أوقف التجديد الجماعي؛ افحص `renewals` و`payment_events` | تسوية عبر `invoice_adjustments` (لا تعدّل الفاتورة)، قرار رد يدوي |
| تجهيز متعثر | طلب `paid` بلا `applied` بعد مهلة، أو مهمة بلا تقدّم/lease منتهٍ | 4.1 | تصعيد `needs_intervention` |
| عدم تطابق desired/observed | `observed_digest` ≠ مقصود الاتفاق، أو فروع/حدود Odoo تخالف الاشتراك | قارن readback بإصدار الاشتراك | أعد reconfigure؛ لا تعلن النجاح قبل التطابق |
| تقادم الاستخدام | `usage_snapshots.freshness` = `stale/unavailable` لأكثر من المهلة | تحقق وصول العامل إلى Odoo | لا تفرض حدودًا/فوترة اعتمادًا على قراءة قديمة بلا قرار |
| فشل تسليم الدعوة | فشل SMTP/ارتداد/دعوة غير مفتوحة | تحقق `LIWAN_MAIL_*` وTLS | أعد إرسال دعوة جديدة (رموز الدعوة محدودة)؛ لا تُرسل كلمة مرور مباشرة |
| عمر النسخة الاحتياطية | آخر نسخة ناجحة أقدم من الهدف، أو فشل restore | شغّل نسخة؛ افحص مساحة/مضيف خارجي | RPO غير معتمد؛ لا وعد SLA قبل قرار |

حدود العتبات (المهل، الأعمار) **مفتوحة** حتى اعتماد أهداف السعة وSLA.

## 6. ما لم يُتحقق منه

- لا يثبت هذا الدليل وجود عامل مشترك نشط أو قبولًا على staging. سجل 2026-10-04 يثبت اختبار إنشاء فاتورة Moyasar وقراءتها في الوضع التجريبي فقط؛ لا يثبت دفعًا مكتملًا أو webhook عامًا أو 3DS أو استردادًا أو مصالحة مزود end-to-end. توفر إعدادات SMTP وstaging الحالي غير متحقق؛ تبقى إجراءات الدفع والبريد **[محجوب]** حتى فحص البيئة وإتمام قبولها.
- الاختبارات المحلية لا تثبت الدفع الحقيقي أو السعة أو الإنتاج؛ لا commit/merge/deploy مأذون.
- فاتورة ZATCA الرسمية خارج النطاق؛ الضريبة 15% حصرية كبند مستقل، وتحتاج مراجعة تاجر/قانونية.
- الأقسام الموسومة **[قبول تشغيلي غير متحقق]** أو **[غير مختبر]** لا تُستخدم كإجراء إنتاج معتمد حتى يثبت قبولها في البيئة المقصودة. لا تعني هذه المراجعة اعتماد staging أو merge أو deploy.
