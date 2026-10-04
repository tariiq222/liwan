# الجزء B — اشتراك العميل والخدمة والفروع والفوترة — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox (`- [ ]`) syntax. Freeze contracts before separate backend/UI assignments. No automatic commits or runtime mutations by workers.

**Goal:** ربط الباقة والحزم باتفاق وفاتورة ودفع وخدمة فعلية، وإدارة فروع العميل وتغييره واشتراكه من واجهة مفهومة.

**Architecture:** Agreement revisions + immutable quotes + durable change orders + billing ledger. دفع موثق يجيز تنفيذًا محددًا؛ عامل منفصل يطبق الهدف ويقرأ النتيجة. العميل يرى الشروط الحالية والطلب المعلق معًا، ولا تحل target revision محل applied revision قبل التحقق.

**Tech Stack:** PostgreSQL/TypeScript/Zod، العامل وPython lifecycle الحاليان، Odoo 19 extensions، Nuxt/Vue، payment/email adapters بعد اختيار المزود.

**Spec:** [تصميم المنتج](../specs/2026-10-02-saas-commercial-product.md)، عقود [الجزء A](2026-10-02-saas-commercial-a-catalog.md)، [الخطة الرئيسية](2026-10-02-saas-commercial-master.md).

## Global Constraints

- قاعدة بيانات ومساحة واحدة للعميل وفروعه؛ لا يستطيع طلب من عميل تغيير أو قراءة عميل آخر.
- HQ ضمن الباقة؛ الفرع الإضافي ضمن الاشتراك نفسه؛ الفروع المدفوعة بعد استبعاد السماح المجاني.
- احتساب الفرع المضاف وسط الدورة بقيمة الأيام المتبقية حتى التجديد.
- الأسعار والشروط المنشورة وإصدارات الاشتراك والفواتير السابقة لا يعاد كتابتها.
- الحفاظ على non_saas والسياسات المحلية مستقلة عن فوترة SaaS.
- Odoo 19.0؛ المصدر الأصلي للقراءة فقط. نوسع الموديولات الموجودة ولا ننسخ أعمدة `project` أو `hr`.
- الاختبارات مع قواعد وخدمات معزولة؛ يمنع الاختبار على `odoo19` أو تنظيف موارد الآخرين.
- هذه خطة فقط؛ لا تتضمن تفويض commit أو merge أو push أو deploy أو حذف عمل قائم.

## Review Focus

1. قبول quote مرتين أو بمفتاح عميل آخر/محتوى مختلف: إعادة متطابقة فقط، وإلا conflict — B1.
2. حدث دفع مكرر/متأخر/مزور/عملة أو مبلغ غير صحيح: لا دفع ولا تنفيذ مضاعف ولا تراجع paid إلى pending — B2.
3. العامل يموت بعد الأثر وقبل تسجيل النجاح: observation واستئناف، لا إعادة الأثر من الصفر — B3/B4.
4. فرع ينجح بعد عبور تاريخ الفوترة، أو يفشل بعد دفع ناجح: وقت خدمة موثق وتسوية مالية واضحة ضمن موافقة العميل — B2/B4.
5. هوية المستخدم أو allowed_company_ids أو restored DB لا تطابق العقد الحالي: رفض العبور وإصلاح الاستحقاق قبل فتح الخدمة — B3/B4/B5.

## العقود المشتركة مع A

تضاف في `packages/commercial-contracts/src/commercial/{subscriptions,orders,billing,branches,usage}.ts` وتصدر عبر `index.ts`. تستخدم RevisionId/Money/Cadence/Quote/EntitlementSnapshot من A؛ لا نسخ متباينة داخل web.

```ts
export type SubscriptionRevision = {
  id: string; subscription_id: string; revision: number; customer_id: string;
  tenant_id: string; plan_revision_id: string; bundle_revision_ids: string[];
  terms_revision_id: string | null; policy_revision_id: string;
  cadence: Cadence; term_start: string; term_end: string;
  period_start: string; period_end: string; included_extra_branches: number;
  extra_branch_count: number; entitlement: EntitlementSnapshot;
}
export type Order = {
  id: string; customer_id: string; subscription_id: string; quote_id: string;
  target_revision_id: string; expected_applied_revision_id: string | null;
  payment_state: 'not_required'|'awaiting_payment'|'paid'|'failed'|'refund_pending'|'refunded';
  fulfillment_state: 'not_started'|'queued'|'applying'|'applied'|'failed'|'needs_intervention';
  effective_at: string | null; idempotency_key: string; request_digest: string;
}
export type EffectReceipt = {
  order_id: string; tenant_id: string; target_revision_id: string;
  observed_entitlement_digest: string; observed_at: string;
  branch_bindings: { branch_id: string; odoo_company_id: number }[];
}
export type UsageSnapshot = {
  tenant_id: string; observed_at: string; policy_revision_id: string;
  metrics: { key: string; used: number; limit: number | null;
    unit: 'users'|'projects'|'attachment_bytes'|'extra_branches' }[];
}
export type Principal = {
  actor_id: string; kind: 'vendor'|'customer'; customer_id: string | null;
  tenant_id: string | null; capabilities: string[];
}
```

الحالة التجارية للاشتراك مستقلة أيضًا (`pending/active/past_due/suspended/cancelled`)، ولا تختصر جميع الحالات في status واحد. الجديد يبدأ pending؛ الطلب المعدل لا يلغي applied القديم عند فشل الهدف. حالة suspended تصدر من سياسة معتمدة فقط، ولا تستنتج من انقطاع مزود الدفع.

### B1 — اتفاق العميل وطلبات التغيير

**الملفات الجديدة:** `apps/control-plane/src/commercial/{subscriptions,orders,customer-terms,authorization}.ts`، `schema_013.sql`، `__tests__/commercial-{subscriptions,orders,authorization}.test.ts`. **تعديل:** `http.ts`, `db.ts` بواسطة المنسق، وعقد tenant الحالي بإضافة روابط تاريخية؛ لا إزالة الفهارس/الحماية القديمة بلا مهاجرة.

**يعتمد على:** A4. **واجهات الخدمة:**

```ts
acceptQuote(input: {
  quote_id: string; expected_subscription_revision: number;
  idempotency_key: string;
}, principal: Principal): Promise<Order>
getSubscription(customerId: string, principal: Principal): Promise<{
  applied: SubscriptionRevision | null; target: SubscriptionRevision | null;
  pending_order: Order | null;
}>
// POST /v1/commercial/orders {quote_id,expected_subscription_revision,idempotency_key}
// GET /v1/commercial/subscriptions/:id
// POST /v1/commercial/customer-terms (vendor only; creates immutable revision)
```

- [ ] اختبارات RED: عميل واحد/اشتراك فعال واحد/tenant واحد، stale409، quote منتهي422، عميل آخر404، replay متطابق يرجع نفس order؛ مختلف409؛ accepted quote لا يصح بعد تغير السلطة/السحب غير المعتمد للبيع الجديد.

```text
Two transactions accept quotes expecting subscription revision 7
Exactly one reserves revision 8; the other receives 409 and requotes
Same principal+key+digest repeated -> same order/invoice reservation
Same key with different customer/quote/content -> 409 without new rows
```

- [ ] تنفيذ transaction يقفل aggregate الاشتراك ويقارن revision، يتحقق quote/scope، ويحفظ target/order/audit/outbox atomic. unique constraints للمفاتيح التجارية؛ التقاط concurrent inserts يعيد قراءة تطابق المحتوى قبل replay.
- [ ] تسجيل التعديلات الخاصة: المصدر الافتراضي، القديم والجديد، السبب، الفاعل، تاريخ الأثر، مدة صلاحية التخصيص إن وجدت. custom bundle/plan يستخدم Audience من A؛ لا raw policy.
- [ ] تعديل حماية `schema_011` التي تقفل package assignment بمهاجرة متعمدة: القديم يبقى تاريخًا، والجديد لا يمر إلا بمراجع subscription/order موثقة. تستمر حماية التعديل المباشر للحقول.
- [ ] إضافة capabilities: `vendor.subscriptions.manage`, `vendor.pricing.manage`, `vendor.billing.manage`؛ لا ترقّى جميع الحسابات تلقائيًا. للعميل `subscription.read` و`subscription.manage` و`branches.manage` بأدوار معتمدة. quote قبول مالي يتطلب مدير اشتراك لا مجرد مستخدم تطبيق.
- [ ] تسجيل GREEN/قيد SQL/اختبار تزامن حقيقي داخل PostgreSQL معزول؛ لا يكتفى promises على mock.

**المخرج/القبول:** اتفاق قابل للتفسير والتخصيص وحفظ التاريخ؛ كل تعديل له هدف واضح ومعاينة وأثر لاحق مستقل.

### B2 — الفواتير والتحصيل والتجديد

**الملفات الجديدة:** `apps/control-plane/src/commercial/{invoices,payments,payment-adapter,renewals,billing-calendar,settlements}.ts`، `__tests__/commercial-{billing,payment-events,renewals}.test.ts`؛ واجهات الفواتير في B5. **عقد التخزين:** invoice/line immutable بعد الإصدار، adjustments/credits منفصلة، payment attempts/events مع uniqueness للمزود+event ID، outbox بعمل قابل لإعادة المحاولة. ضمن schema_013 عند تسلسلها مع B1، أو رقم لاحق جديد إن سبق تطبيقها؛ لا تعديل مهاجرة مطبقة.

**يعتمد على:** B1 واختيار مزود الدفع واعتماد السياسة المالية. simulator محلي لا يحقق قبول المزود؛ لا يدخل قرار مزود جديد ضمن هذه الوثيقة.

```ts
export type ProviderEvent = {
  provider: string; event_id: string; attempt_id: string;
  merchant_account: string; status: 'pending'|'succeeded'|'failed'|'refunded';
  amount: Money; occurred_at: string;
}
export interface PaymentAdapter {
  createAttempt(input: { attempt_id: string; order_id: string; amount: Money;
    idempotency_key: string; return_url: string }): Promise<{redirect_url: string}>;
  verifyEvent(raw: Uint8Array, headers: Record<string,string>): Promise<ProviderEvent>;
  lookupAttempt(attemptId: string): Promise<ProviderEvent>;
}
// POST /v1/commercial/orders/:id/payment-attempts (same-origin scoped request)
// POST /v1/commercial/payment-events/:provider (raw body verified; no browser auth)
// GET /v1/commercial/invoices, /:id (scoped list/detail/download)
```

- [ ] كتابة اختبارات RED للحالات: event مكرر؛ succeeded ثم pending متأخر لا يعيد فتح دين؛ مبلغ/عملة/تاجر خاطئ يرفض؛ return_url مزور يرفض؛ provider timeout يعاد الاستعلام عنه قبل إنشاء محاولة جديدة؛ paid بعد cancelled يحتاج reconciliation لا تفعيل صامت.

```text
Attempt: order=A, amount=100000 SAR-minor, merchant=M
Verified succeeded(event=E) twice -> one payment, one fulfillment outbox message
Unverified E / different currency / different merchant -> no payment/no outbox
Later pending(event=F) -> paid remains paid; event retained for audit
Order marked paid from browser return alone -> forbidden
```

- [ ] إنشاء invoice من Quote نفسه، مع IDs للمصادر والوحدات والفترة والكمية والسماح. لا تسمى وثيقة preview فاتورة رسمية ولا تفترض ضريبة صفر بسبب نقص إعدادها. الرقم النهائي والتسويات وفق السياسة المعتمدة ومراجعة متطلبات المزود/الفاتورة وقت التنفيذ.
- [ ] تنفيذ adapter للمزود المختار بمفتاح بيئة اختبار فقط؛ مراجعة وثائقه الرسمية الحالية وتثبيت عقود signature/idempotency/expiry/callback. عدم تسجيل بيانات البطاقة أو أسرار الدفع، وعدم قبول redirect خارجي غير موثق.
- [ ] تحقق webhook الخام وربط التاجر/المحاولة/الطلب/المبلغ/العملة، ثم transaction payment+event+outbox؛ توقيع صحيح وحده لا يكفي. reconciliation دوري لمحاولة نتيجتها مجهولة.
- [ ] صفر فعلي موثق يسمح `not_required`؛ إعفاء/ائتمان يدوي يحتاج سياسة وصلاحية وسجل، ولا نسميه paid لدى المزود. لا يعطي developer toggle وصولًا مجانيًا في المنتج.
- [ ] إنشاء renewal لكل فترة مستقلة بمفتاح `subscription_id + period_start + invoice_kind`، ومنع تكرار scheduler. احتساب تاريخ مرساة شهرية/سنوية، تغيير الأسعار وفق سياسة معتمدة فقط، إشعار بالموعد والمبلغ، وتعثر التحصيل/مهلة السماح وفق policy revision.
- [ ] إذا أراد العميل تجديدًا تلقائيًا يلزم consent موثق ورمز وسيلة الدفع من المزود، دون تخزين البطاقة. إذا لم يفعّل ذلك يرسل طلب دفع؛ لا تدعي أتمتة تحصيل غير متاحة.
- [ ] تنفيذ تسوية فشل/تأخر التفعيل: refund/credit pending ظاهر، وربط الأصل والتعديل؛ لا حذف محاولة ناجحة. تفعيل في دورة أخرى يعيد طلب موافقة عندما يتجاوز حدود العرض المقبول.
- [ ] GREEN محلي ثم تجربة مزود sandbox: نجاح/رفض/إلغاء/timeout/duplicate/reconciliation/refund إن يدعمه المنتج المعتمد. قبول renewal بمحاكاة ساعة حقن محددة ثم اختبار حدث مزود فعلي؛ لا ننتظر شهرًا ولا نغير ساعة النظام.

**المخرج/القبول:** مبلغ الفاتورة = عرض السعر المعتمد بعد التسويات المعلنة، والحالة تطابق المزود. فاتورة وتجديد واحدان للفترة، وحالة العجز والدين والمهلة مفهومة. الدفع الحقيقي للإنتاج بوابة C3 منفصلة.

### B3 — تطبيق الاتفاق والدخول وتغيير الخدمة

**الملفات الجديدة:** `apps/control-plane/src/shared/{subscription-reconfigure,subscription-reconcile,admin-invitations}.ts`، `__tests__/shared-subscription-{reconfigure,recovery,invitations}.test.ts`. **تعديل:** `shared/{job-dispatcher,job-store,job-worker,odoo-adapter,onboarding}.ts`, `packages/commercial-contracts/src/shared/provisioning.ts`, `tools/shared_saas_lifecycle/odoo_effect.py`, `tools/nasq_cli/managed_policy.py`. **اختبار Python جديد:** `tools/shared_saas_lifecycle/test_subscription_effect.py`.

**Odoo:** `nasq_platform/models/{tenant_profile,entitlement_service}.py` مع revision bindings؛ تغيير الإنفاذ الدقيق فقط عند الحاجة ومراجعة odoo-workflow. لا تغيّر `_name` أو بنية tenant المحلية بدون migration/version bump/tests.

**يعتمد على:** B1/B2 وA1. أول enrollment يستخدم provision الحالي بسلطة subscription مثبتة؛ التعديل يستخدم job جديد `reconfigure` ومفتاح `tenant_id + target_revision_id`، لا singleton provision القديم.

```ts
type ReconfigureRequest = {
  tenant_id: string; order_id: string; previous_revision_id: string;
  target_revision_id: string; entitlement_digest: string;
}
enqueueSubscriptionEffect(orderId: string): Promise<{job_id: string}>
reconcileSubscriptionEffect(receipt: EffectReceipt): Promise<void>
```

- [ ] اختبارات RED: دفع ناجح/enqueued ليس applied؛ target digest خاطئ يرفض قبل الأثر؛ job قديم لا يكتب فوق هدف أحدث؛ worker crash بعد effect لا يكرر modules/branch؛ quota downgrade دون الاستخدام يرفض أو يظل scheduled وفق policy، ولا يحذف البيانات.

```text
Order paid, effect queued -> UI says "جارٍ التفعيل", login readiness not inferred
Observed digest != target digest -> needs_intervention, applied revision unchanged
Crash after Odoo commit before receipt -> recover by observation and recorded operation ID
Restore old DB with revision 3 while agreement revision 5 -> reconcile before traffic opens
```

- [ ] تجميد authority snapshot للطلب: subscription/order/quote/payment-release/catalog/compiler/tenant binding. العامل يعيد التحقق منه ولا ينفذ browser policy. جداول durable journal وlease fencing والـoutbox تعاد الاستفادة منها.
- [ ] قبل تغيير modules أخذ snapshot/نسخة مناسبة وخطة أثر وإرجاع. لا uninstall تلقائي ولا rollback ترقية قاعدة بمجرد عكس JSON؛ عند تعذر الرجوع توضح حالة needs_intervention ويطبق recovery موثق.
- [ ] إضافة مراحل preflight→applying→verifying→applied، مع أثر revision في Odoo وتحقق ميزات وحدود وإصدار modules وصلاحيات الدخول. `desired/observed` الحالية تبقى، ويربط بها commercial target/applied صراحة.
- [ ] اعتماد invitation مسؤول قصيرة العمر واستعمال واحد، password setup/recovery وإبطال token وإثبات البريد وربط الشركة؛ إعادة إرسال لا تكشف كلمة المرور. دعوة خارجية تحتاج قناة إرسال مهيأة واختبار تسليم. لا تعرض الملف الخاص بكلمات المرور المستخدم في قبول محلي قديم.
- [ ] إضافة outbox دعوة بعد جاهزية الخدمة، مع صفحة «نجهز مساحتك» ومحاولة استئناف ورابط دخول من host موثوق؛ الانقطاع لا ينشئ شركة ثانية. لا ندّعي جاهزية دعوتها بسبب رسالة بريد في log فقط.
- [ ] GREEN لوحدات العامل، ثم رحلة provision/reconfigure حقيقية على tenantين مع سجل ومرفق قبل وبعد التغيير. entitlement لا يتجاوز صلاحيات الدور ولا يفعل تطبيقًا غير مشترى.

**المخرج/القبول:** تأكيد الاشتراك يفتح الطريق إلى مساحة حقيقية قابلة للدخول؛ تغيير حزمة عميل قائم له نتيجة متحققة وحالة تعثر قابلة للإصلاح دون نجاح كاذب.

### B4 — فروع حقيقية واستحقاقها واستخدامها

**الملفات الجديدة:** `apps/control-plane/src/commercial/{branches,usage}.ts`، `__tests__/commercial-{branches,usage}.test.ts`؛ `odoo-addons/nasq_platform/models/branch_service.py`، `tests/test_branch_service.py`؛ `odoo-addons/nasq_api/controllers/branches.py` و`tests/test_branches.py`؛ `tools/shared_saas_lifecycle/test_branch_effect.py`. **تعديل:** ملفات `__init__.py` والmanifest/ACL/record rules حسب المصدر، `nasq_core/models/res_company.py` لتوسعة مدروسة فقط، quota service وsnapshot contracts عند الحاجة. تتبع source brief في الخطة الرئيسية ثم أعده عند التنفيذ قبل أي Odoo code.

**يعتمد على:** B1/B2/B3. جدول control-plane `branch_binding` يحتفظ UUID الفرع وtenant/company/root ومعرف operation وحالته؛ Odoo res.company هو كيان العمل. لا ينشئ العميل root ثانيًا ولا tenant آخر.

```text
POST /v1/commercial/branch-quotes -> Quote (requested branch names/quantity scoped)
POST /v1/commercial/orders -> same B1 acceptance, not a second billing protocol
GET /v1/commercial/subscriptions/:id/branches -> {items,total,HQ,free,paid}
GET /v1/commercial/subscriptions/:id/usage -> UsageSnapshot + freshness status
Odoo branch apply: signed operation_id + target_revision + root binding
Result: EffectReceipt with stable branch_id ↔ odoo_company_id mapping
```

- [ ] اختبارات RED للأساس: HQ لا يحسب؛ إضافية3/مجاني1→مدفوع2؛ فرع archived لا يزيل تاريخه؛ branch retry لا يخلق نسخة؛ عميل آخر لا يقرأه؛ منع إنشاء res.company يدويًا للالتفاف على quota؛ منع root جديد.
- [ ] اختبار تزامن في SQL فعلي: إضافتان عند بقاء فرع مجاني واحد؛ أول حجز يأخذ المجاني والثاني يعيد عرضًا للمدفوع، لا ينفذ طلب دفع دون معاينة جديدة. تدخل الفروع pending في حجز السعة، والفروع الفعالة في محاسبة الخدمة وفق policy.
- [ ] خدمة Odoo ضيقة تتحقق capability والعملية والحصة والroot وتنفذ company child idempotently. لا تمنح `base.group_system` لمسؤول الشركة كي ينشئ فروعًا. مجموعة وصول العميل للفروع وقواعد السجلات مقيدة؛ راجع روابط المستخدم/الموظف/المشروع/المرفق والبحث.
- [ ] الفرع المنشأ يرث إعدادات أساسية وفق Odoo ويقبل تخصيص الاسم والهوية المسموح بها؛ اختيار الفرع الحالي يُحفظ بأمان، ولا يعطي الاطلاع على أخواته دون صلاحية. مسؤول الشركة المخول يرى جميع فروع شركته فقط.
- [ ] ربط تاريخ التفعيل الفعلي بالحساب اليومي من A4، وإصدار تسوية حسب B2 لتأخر التفعيل أو عبور التجديد. يظهر السعر الكامل عند التجديد. تخفيض/أرشفة الفرع يسير كطلب تجاري يحفظ البيانات ولا يعد المستخدم برد تلقائي قبل السياسة.
- [ ] usage snapshot من Odoo بمصدر وتوقيت، يشمل المستخدمين المحتسبين والمرفقات والمشاريع والفروع. يعرض stale/unavailable بوضوح؛ لا يسجل 0 عند فشل الجلب. العد نفسه المستخدم في quota enforcement، ولا يعتمد مجموع رسوم الفاتورة بوصفه عددًا تشغيليًا.
- [ ] قبول Odoo ومتصفح: مقر+3 فروع (واحد مجاني)، مسؤول محدود لفرع، مسؤول الشركة، شركة ثانية؛ بيانات ومرفقات واستعلامات وإجراءات مباشرة ممنوعة خارج النطاق.

**المخرج/القبول:** ما يظهر فرعًا في الاتفاق موجود في النظام وله صلاحيات، ويظهر المجاني والمدفوع ورسوم الأيام المتبقية بدقة دون إنشاء عميل مستقل.

### B5 — تجربة المدير وتجربة العميل كاملة

**الملفات:** تعديل `apps/web/app/pages/vendor/{overview,tenants/[id],tenants/new}.vue` و`tenants/index.vue`؛ إنشاء `pages/vendor/invoices.vue` و`invoices/{index,[id]}.vue`؛ صفحات جديدة للعميل `pages/subscription.vue`, `subscription/{index,change,invoices,branches}.vue`؛ صفحات enrollment `pages/subscribe.vue`, `subscribe/{index,review,status}.vue`؛ قصص ومكونات متخصصة في `components/subscription/` و`stories/subscription/`؛ `composables/useSubscription.ts` و`server/api/commercial/v1/[...path].ts` و`server/utils/customer-commercial.ts`. اختبار `server/utils/__tests__/customer-commercial.test.ts`، و`pages/__tests__/subscriptionJourney.test.ts`.

مسار إنشاء الفرع `/subscription/branches/new` يستخدم SharedCreatePanel في إنشاء record؛ مراجعة شراء/تغيير اتفاق صفحة كاملة `/subscription/change`، لا dialog تجاري مكدس. راجع نمط parent.vue الحالي للروابط والعودة. المنسق وحده يعدل `nav/shellModules.ts`, `createActions.ts`, `activeRoute.ts`، وتسجيل locales والstories المشتركة.

**يعتمد على:** عقود B1–B4. يمكن كتابة Storybook/حالات loading/empty/error مبكرًا؛ لا تقبل الشاشة كمنجزة قبل توصيلها وإثبات أثرها الحقيقي.

- [ ] قبل بناء كل صفحة، تثبيت سؤالها الرئيسي وprimary action وحقولها وحالاتها كما في جدول مواصفات المنتج. لا تملأ الصفحة بUUID/JSON، ولا تستبدل قيم الاستخدام بـfixtures خارج Storybook.
- [ ] النظرة العامة: أعداد active/pending/past_due والتجديدات وطلبات التعثر من read models حقيقية. إن ظهرت مؤشرات الإيراد تفصل المحصل والمستحق والمتكرر وتحدد الفترة؛ لا تستنتج دخلًا محصلًا من قائمة أسعار.
- [ ] ملف العميل: ملخص تجاري ثم اشتراك/خدمات/فروع/استخدام/فواتير/سجل؛ applied الحالي واضح بجانب pending target. زر التخصيص يعرض الفرق والسعر والتاريخ قبل الحفظ المعتمد.
- [ ] بوابة الاختيار: اختيار باقة وحزم، إنشاء/تحقق هوية مسؤول وشركة، مراجعة Quote وشروطه، دفع، متابعة تجهيز، دخول. pending identity تمنع الاستيلاء على شركة موجودة؛ مفاتيح الاشتراك لا تكفي لامتلاكها.
- [ ] بناء BFF customer-scoped مستقل عن مفاتيح vendor. principal ينشأ من session/tenant mapping موثوق؛ لا يقبل tenant_id أو capabilities من query/body كسلطة. عند وجود tenant host يستخدم binding الموقع، وقبل provision يستخدم هوية enrollment موثقة. CSRF/replay/rate limits لطلبات التعديل والدعوات.
- [ ] صفحة اشتراكنا تعرض الحالي والقادم والحزم والحدود والفواتير والتجديد. غير المخول يرى فقط معلومات دورِه؛ إدارة الدفع/الفروع خاصة بالمخول. رابط الفاتورة/المرفق يتحقق من الشركة حتى لو عرف المستخدم ID.
- [ ] مكتبة مكونات بأساليب DESIGN.md، عربي/إنجليزي، RTL، لوحة مفاتيح/focus، أخطاء حقول بعد التفاعل المناسب، empty/loading/retry/conflict/permission، منع النقر المكرر، حماية المسودة، safe returnTo، refresh/back.
- [ ] اختبار متصفح يقيس القيمة لكل صفحة: يصل المستخدم للإجراء، يقرأ أثره، ينفذه أو يلغيه، ثم يرى الحالة الحقيقية بعد reload. إغلاق مراجعة صفحات المستخدم طلبًا أساسيًا، لا ملحقًا بعد التشغيل.

```text
Customer A authenticated -> edit request with tenant B in body/query -> rejected
Vendor read-only -> prices visible only within permission; mutation -> 403
Customer confirms branch quote -> pending state -> real branch observed -> applied
Price is changed in browser devtools -> server quote/invoice remains authoritative
Refresh payment status URL -> same attempt/order; no new charge
```

**المخرج/القبول:** يستطيع المدير والعميل شرح كل صفحة واستخدامها دون معرفة أسماء الموديولات أو job IDs. لا زر نجاح غير موصول ولا انتقال يفقد المسودة أو يعرض بيانات شركة أخرى.

## التحقق والتسليم

المنسق ينفذ اختبارات كل مهمة المركزة أولًا ثم التحقق المشترك مرة بعد دفعة مستقرة. أمثلة الملفات المقررة:

```sh
npm -w apps/control-plane test -- src/__tests__/commercial-subscriptions.test.ts src/__tests__/commercial-orders.test.ts src/__tests__/commercial-authorization.test.ts src/__tests__/commercial-billing.test.ts src/__tests__/commercial-payment-events.test.ts src/__tests__/commercial-renewals.test.ts
npm -w apps/control-plane test -- src/__tests__/shared-subscription-reconfigure.test.ts src/__tests__/shared-subscription-recovery.test.ts src/__tests__/shared-subscription-invitations.test.ts src/__tests__/commercial-branches.test.ts src/__tests__/commercial-usage.test.ts
python3 -m unittest tools.shared_saas_lifecycle.test_subscription_effect tools.shared_saas_lifecycle.test_branch_effect
npm -w apps/web run test
npm -w apps/web run lint
npm -w apps/web run build
```

قواعد SQL وOdoo والـprovider منفصلة: scratch PostgreSQL للاختبارات ذات side effects، Odoo scratch لإثبات الإنفاذ، sandbox للمزود. fixtures عقود ثم live ثم browser، ولا يستبدل أحدها الآخر. Odoo installation/upgrade/security/i18n/checks حسب CLAUDE.md وodoo-workflow، مع عدد اختبارات غير صفري وpaths/config/data/log معزولة. تسلم الأدلة في `docs/verification/saas-commercial-b.md` بما فيها تطابق رقم order/quote/invoice/job/observed revision دون أسرار.
