# الجزء A — التطبيقات والحزم والباقات والتسعير — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox (`- [ ]`) syntax. Coordinator owns shared contracts, migrations, integration and final checks. No automatic commit.

**Goal:** تمكين مدير SaaS من تكوين حزم قابلة للتشغيل وباقات قابلة للبيع، وإظهار عرض سعر موثوق قبل أي اشتراك.

**Architecture:** مصدر تطبيقات موثق بإصدارات ثابتة → إصدارات حزم وباقات وأسعار → مترجم استحقاقات ومحرك تسعير مركزي. تشترك الواجهة والعامل في العقود، ولا يثق الخادم في حسابات المتصفح.

**Tech Stack:** TypeScript/Zod/PostgreSQL، Nuxt/Vue/Nuxt UI/Storybook، Vitest؛ توافق Python/Odoo كما يحدده مترجم الاستحقاقات.

**Spec:** [تصميم المنتج](../specs/2026-10-02-saas-commercial-product.md)؛ [الخطة الرئيسية](2026-10-02-saas-commercial-master.md).

## Global Constraints

- HQ ضمن الباقة؛ الفرع الإضافي ضمن الاشتراك نفسه؛ الفروع المدفوعة بعد استبعاد السماح المجاني.
- احتساب الفرع المضاف وسط الدورة بقيمة الأيام المتبقية حتى التجديد.
- الأسعار والشروط المنشورة وإصدارات الاشتراك والفواتير السابقة لا يعاد كتابتها.
- لا تظهر ميزة قابلة للبيع أو التخصيص دون عقد واضح وإنفاذ خلفي واختبار فعلي.
- العربية والإنجليزية وRTL، مكونات Storybook المعتمدة، وسياسة DESIGN.md: `/new` في SharedCreatePanel، السجل والتعديل صفحات، الحذف بتأكيد ضمن الصفحة، حماية المسودة والعودة والروابط المباشرة.
- هذه خطة فقط؛ لا تتضمن تفويض commit أو merge أو push أو deploy أو حذف عمل قائم.

## Review Focus

1. حزمة تضم تطبيقًا يعتمد على آخر غير مختار: تظهر الاعتمادية وأثرها، ولا تفشل الخدمة بعد الشراء — A1/A2.
2. تغيير ملف catalog في الإصدار القادم: إعادة الاشتقاق لإصدار منشور قديم تظل ممكنة وآمنة — A1.
3. حقل فارغ أو 0 أو null، وتعارض حدود حزم: لا يتحول غير المحدد إلى مجاني أو غير محدود — A1/A3/A4.
4. سعر خاص أو منحة فرع، شهر قصير/سنة كبيسة، وتفعيل متأخر: الحساب يطابق الشروط والفترة المعروضة — A4.
5. تعديل/نشر متزامن أو حذف منشور: لا تضيع نسخة مراجعة ولا يتغير تاريخ عميل — A2/A3.

## ملفات ومسؤوليات الجزء

كل مسار جديد أدناه **مقترح للإنشاء أثناء التنفيذ**، وليس ادعاء وجوده. المسارات الحالية والمقترحة نسبية لجذر checkout التنفيذ. أي إعادة تسمية تعتمد عند المرحلة 0 وتطبق على جميع الأجزاء مرة واحدة.

| المسؤولية | ملفات جديدة | نقاط التكامل الحالية |
|---|---|---|
| العقود العامة | `packages/commercial-contracts/src/commercial/{types,schemas,catalog,bundles,plans,quotes}.ts` | `src/index.ts` و`src/server.ts` في الحزمة نفسها |
| المصدر والمترجم | `apps/control-plane/src/commercial/{catalog-releases,entitlements}.ts` | `deploy/catalog/solutions/platform.json`، `packages.ts` الحالي كمسار توافق |
| التخزين/HTTP | `apps/control-plane/src/commercial/{bundles,plans,quotes,http}.ts` | `http.ts`, `db.ts`, `schema_011.sql` القائم دون إعادة كتابته |
| المهاجرة | `apps/control-plane/src/schema_012.sql` | المنسق يعيد فحص آخر رقم قبل الحجز؛ لاحقًا 013 و014 في B/C |
| واجهة الحزم | `apps/web/app/pages/vendor/bundles.vue`، `bundles/{index,new,[id]}.vue`، `bundles/[id]/edit.vue`، `components/vendor/BundleForm.vue` | `pages/vendor/catalog*` الحالي يبقى طريق توافق/تفاصيل تقنية |
| الباقات | `apps/web/app/pages/vendor/plans.vue`، `plans/{index,new,[id]}.vue`، `plans/[id]/edit.vue`، `components/vendor/PlanForm.vue` | `apps/web/app/composables/useVendorApi.ts` و`useApi.ts` الحاليان دون عميل HTTP منافس |
| العرض المشترك | `apps/web/app/components/vendor/{PriceBreakdown,EntitlementSummary}.vue` | `i18n/locales/{ar,en}/vendor.json`، `stories/vendor/`، فهرس مكونات التصميم |
| اختبارات | `packages/commercial-contracts/src/__tests__/commercial-*.test.ts` و`apps/control-plane/src/__tests__/commercial-{catalog,bundles,plans,quotes}.test.ts` | اختبارات package الحالية تستمر أثناء الانتقال |

المهاجرات متتابعة ويملكها المنسق. تحفظ المسودة محتواها ورقم concurrency؛ تحفظ النسخة المنشورة digest مستقلًا وقيمها ومصدرها. لا يحمل جدول واحد معنى draft المتغير ومعنى agreement التاريخي دون فصل الإصدارات.

## عقد مشترك بين الأجزاء

تعرف الأنواع التالية في `commercial/types.ts` وتفحص Zod الحدود والقيم على الشبكة. `number` المالي على الشبكة عدد صحيح آمن فقط؛ الحساب الداخلي بـBigInt/كسور صحيحة، ويُرفض تجاوز المجال قبل التحويل.

```ts
export type RevisionId = string // UUID؛ ليس رقم إصدار قابلًا للتخمين
export type Money = { currency: string; exponent: number; minor: number }
export type Cadence = { unit: 'month' | 'year'; count: number }
export type CapacityMap = Record<string, number | null>
export type Lifecycle = 'draft' | 'validated' | 'published'
export type Audience = { kind: 'public' } | { kind: 'customer'; customer_id: string }
export type Selection = { app_id: string; feature_keys: string[] }
export type CatalogApplication = {
  id: string; name_ar: string; name_en: string; modules: string[];
  requires_apps: string[]; conflicts_with_apps: string[];
  features: { key: string; selectable: boolean; requires: string[];
    enforcement_refs: string[] }[];
}
export type CatalogRelease = {
  id: RevisionId; version: string; source_digest: string;
  artifact_digest: string; applications: CatalogApplication[];
}
export type Price = { cadence: Cadence; amount: Money }
export type BundleRevision = {
  id: RevisionId; bundle_id: string; version: number; edit_revision: number;
  name: string; description: string; audience: Audience;
  status: Lifecycle; available: boolean; catalog_release_id: RevisionId;
  selections: Selection[]; domain_limits: CapacityMap; prices: Price[];
}
export type PlanRevision = {
  id: RevisionId; plan_id: string; version: number; edit_revision: number;
  name: string; status: Lifecycle; available: boolean; audience: Audience;
  term_months: number; prices: Price[]; platform_limits: CapacityMap;
  included_bundle_revision_ids: RevisionId[]; optional_bundle_revision_ids: RevisionId[];
  included_extra_branches: number; extra_branch_prices: Price[];
  extra_branches_limit: number | null; policy_revision_id: RevisionId;
}
export type CustomerTermsRevision = {
  id: RevisionId; customer_id: string; reason: string;
  base_price?: Price; bundle_prices?: Record<RevisionId, Price>;
  included_extra_branches?: number; extra_branch_price?: Price;
  extra_branches_limit?: number | null; limits?: CapacityMap;
  term_months?: number; cadence?: Cadence;
}
export type EntitlementSnapshot = {
  catalog_release_id: RevisionId; modules: string[];
  features: Record<string, boolean | number | null>;
  compiler_version: string; digest: string;
}
```

الاسم والوصف المحليان يضافان بالشكل الموافق لعقد ترجمة الكتالوج؛ لا يترجم اسم إدخاله العميل آليًا. `prices` قائمة أسعار صريحة لدورات محددة، وليست حاصل ضرب إجباري لسعر شهري. كل cadence يطابق عددًا صحيحًا موجبًا، ومدة العقد تدعم الدورات المعتمدة ولا تنتهي في نصف دورة بلا قاعدة صريحة. رسم تأسيس الفرع ليس مضافًا بهذه الأنواع؛ إن اعتمدته المرحلة 0 يضاف بند منفصل قبل تجميد العقد.

التخصيص الكامل لمكونات حزمة أو باقة لعميل يتم بإصدار خاص `audience.customer`، مع نفس المراجعة والاعتماد. CustomerTermsRevision يخصص الشروط ولا يسمح بتمرير policy أو modules من المتصفح. لا يستطيع عميل آخر قراءة الإصدار الخاص أو الاشتراك فيه.

### A1 — مصدر التطبيقات ومترجم الاستحقاقات

**المدخل:** catalog موثق، إصدارات الحزم والباقة وشروط العميل. **المخرج:** قائمة تطبيقات عربية مفهومة وEntitlementSnapshot حتمي قابل للتطبيق. **يعتمد على:** المرحلة 0.

**واجهات:**

```ts
compileEntitlements(input: {
  release: CatalogRelease; plan: PlanRevision;
  bundles: BundleRevision[]; terms: CustomerTermsRevision | null;
}): EntitlementSnapshot
loadCatalogRelease(id: RevisionId): Promise<CatalogRelease>
// GET /v1/commercial/catalog/releases => {items: CatalogRelease[], total: number}
```

- [ ] كتابة اختبارات compiler قبل التنفيذ: union للموديولات مع dedup، ترتيب ثابت/digest ثابت، دورة اعتماد أو تعارض يرفض، ميزة غير قابلة للاختيار ترفض، تعارض حد بلا مرجح يرفض، null و0 منفصلان، غير SaaS لا يتأثر.

```ts
// تجهز fixtures داخل ملف الاختبار من الأنواع أعلاه، وبإصدار كتالوج محفوظ.
expect(compileEntitlements(input).modules).toEqual([...new Set(expectedModules)].sort())
expect(() => compileEntitlements(conflictingLimits)).toThrow('ambiguous_limit')
expect(() => compileEntitlements(unsupportedFeature)).toThrow('feature_not_selectable')
expect(compileEntitlements(sameSelectionDifferentOrder).digest)
  .toBe(compileEntitlements(input).digest)
```

- [ ] تسجيل RED باختبار الملف الجديد فقط؛ فشل fixture أو import لا يغني عن اختبار دلالة الحالات بعد وجود الواجهة.
- [ ] إنشاء artifact لكل release بالموديولات والميزات والاعتماديات وhash للبايتات الموثقة. يبقى artifact القديم متاحًا لإعادة المحاولة/الاستعادة؛ لا يربط إصدار مباع بالملف الحالي وحده.
- [ ] إعداد قائمة التطبيقات الحالية ومفاتيحها من Odoo وكتالوج النشر. كل feature selectable له enforcement_refs إلى guard واختبار. تعرض الخيارات غير المستقلة كوصف مشمول مقفل، لا خيار بيع قابل للإطفاء.
- [ ] تنفيذ compiler نقي مع تحقق المصدر والأهلية ومصدر كل حد؛ تخزين compiler_version مع الاشتقاق. لا تثبت تحديث compiler على اشتراك سابق بصمت.
- [ ] تمرير snapshot الموثق إلى adapters عبر العقود الحالية بإصدار واضح؛ B3 يكمل التطبيق الفعلي. يراجع المنسق توافق Python verifier قبل قبول هذا العقد.
- [ ] تحقق GREEN للمترجم ومقارنة نتائج TypeScript/fixture الموثق الذي سيستهلكه Python؛ تغيير ملف catalog الحالي لا يمنع قراءة release سابق.

**قبول A1:** يمكن تفسير كل عنصر في المصمم بالموديول والميزة والحد الفعلي، ويُرفض غير المدعوم قبل النشر.

### A2 — مصمم الحزم وحياتها

**المدخل:** A1. **المخرج:** صفحة حزم مفهومة وCRUD وإصدارات منشورة قابلة للبيع، عامة أو مخصصة لعميل.

**العقد:** `/v1/commercial/bundles` list/create، `/:id` read/update/delete draft، `/:id/{validate,publish,withdraw,restore,revisions}`. كل mutation يتطلب `edit_revision` وreason وcapability؛ إنشاء revision يرجع draft جديدًا. النشر يثبت المحتوى والسعر وrelease/digest، والسحب availability منفصلة. read/list `{items,total}`. رمز409 للتعارض،422 لطلب غير صالح،403 لغياب الصلاحية دون كشف بيانات خاصة.

- [ ] إضافة اختبارات حياة البيانات والنشر/التعديل المتزامن والنسخ والسحب ومنع حذف referenced revision. تغطي contract tests طلب API مباشر خارج الواجهة.

```text
Given draft revision=3 and validated_digest=D
When content changes with expected_revision=3
Then status=draft, revision=4, validated_digest cleared
When a stale publish uses revision=3 -> 409; no published row
When a used published revision is deleted -> 409; referenced subscription unchanged
When another customer requests a private bundle -> 404; no content disclosure
```

- [ ] تنفيذ schemas وSQL immutability ومخزن bundle منفصل عن legacy package؛ منع arbitrary modules/feature IDs عبر A1. edit بالنسخة المنشورة ينشئ مسودة، لا يعدلها.
- [ ] بناء جدول/بطاقات اسم الحزمة ووظيفتها، تطبيقاتها وميزاتها وحدودها وسعرها وحالتها وإجراءها التالي. تفاصيل المصدر تحت قسم تقني اختياري.
- [ ] إنشاء BundleForm بمكونات معتمدة وقصة Storybook: اسم/وصف، اختيار التطبيقات، الميزات التابعة، الحدود الخاصة بالمجال، الأسعار/الدورات، الجمهور العام أو عميل محدد، مراجعة المحتوى قبل النشر.
- [ ] عرض «مسودة → جاهزة للاعتماد → منشورة ومتاحة» مع أثر كل انتقال؛ السبب مطلوب عند النشر/السحب/الحذف في موضع الإجراء، لا textarea مبهم أعلى كل الصفحة.
- [ ] إكمال حماية المسودة والعودة والrefresh وتفويض الأزرار والخادم مع اختبارات مركزة. قبول متصفح للإنشاء، تعديل، خطأ، تعارض، نشر، نسخة جديدة وسحب.

**قبول A2:** ينشئ المدير حزمة مشاريع ويفهم ما تشمل وما سيحصل عليه العميل، وتبقى بعد إعادة تشغيل الخادم. نشر نسخة جديدة لا يغير العملاء القدامى.

### A3 — مصمم الباقات والأسعار

**المدخل:** A2، سياسات المرحلة 0. **المخرج:** باقة تصف الاشتراك والفوترة والفروع بأسعار قابلة للحساب.

**العقد:** `/v1/commercial/plans` ونفس إجراءات دورة حياة A2 على PlanRevision. لا يكرر كود lifecycle إن أمكن مشاركته داخل server فقط. `vendor.catalog.manage` للمكونات؛ تنشأ capability منفصلة `vendor.pricing.manage` للأسعار، مع منح صريح ومراجعة لمن يستطيع الجمع بينهما.

- [ ] كتابة اختبارات رفض باقة تنشر bundle مسحوبة/مسودة/خاصة بعميل آخر، دورة بلا سعر، أسعار بعملتين، مجاني=0، حد غير محدد=null، حد فروع أقل من المجاني، عقد غير متوافق مع الدورة المختارة.

```text
Plan includes projects; optional HR; platform users=20, attachments=2048 MiB
HQ is included; included_extra_branches=1; extra_branch_limit=8
Monthly branch price=50000 minor SAR; annual branch price separately supplied
Publish without annual price while annual cadence selectable -> 422
Publish with 0 monthly branch price -> valid free branch, not missing value
```

- [ ] إنشاء schema_012 بعد حسم رقمها، مع جداول releases/bundle revisions/plan revisions/policy revisions؛ constraint لكل اتفاق عملة واحدة، FKs لإصدارات immutable، ومؤشرات قائمة/بحث. لا تغير schema_011 التاريخية بعد تطبيقها.
- [ ] إنشاء PlanForm: معلومات، مدة العقد، دورات فوترة وأسعارها، المشمول/الاختياري، الحدود، مقر مشمول وفروع مجانية ومدفوعة، شروط التجربة والتجديد المعتمدة.
- [ ] تنفيذ إنشاء/تعديل/مراجعة/نشر/إيقاف/نسخة جديدة/حذف مسودة، وبيان عدد العملاء المرتبطين بالإصدار. لا تغير القائمة العامة اتفاقاتهم.
- [ ] إظهار مقارنة الباقات من هذه العقود نفسها، ومصدر أي override؛ استكمال Storybook والترجمة واختبارات السلوك والحفظ والتفويض.

**قبول A3:** يستطيع المدير تكوين عقد سنوي بفواتير شهرية، أو سنوي مدفوع سنويًا، ومقارنة حزمها وحدودها وفروعها دون خلط المدة بالسعر.

### A4 — عرض السعر والحساب

**المدخل:** plan/bundles/terms منشورة ومثبتة، عدد الفروع وتوقيت الفوترة وسياسة الضريبة المقرّة. **المخرج:** معاينة السعر ثم Quote محفوظ مؤقتًا لا يتغير محتواه.

تعرف في `quotes.ts` الأنواع المصدرة المشتركة التالية، إضافة لأنواع A:

```ts
export type QuoteLine = {
  key: string; kind: 'base'|'bundle'|'branch'|'discount'|'tax'|'adjustment';
  description: string; quantity: number; amount: Money;
  period_start: string; period_end: string; source_revision_id: RevisionId;
}
export type Quote = {
  id: string; customer_id: string; subscription_id: string | null;
  expected_subscription_revision: number; plan_revision_id: RevisionId;
  bundle_revision_ids: RevisionId[]; terms_revision_id: RevisionId | null;
  entitlement_digest: string; requested_extra_branches: number;
  cadence: Cadence; effective_date: string; policy_revision_id: RevisionId;
  lines: QuoteLine[]; due_now: Money; next_renewal: Money;
  next_renewal_at: string; expires_at: string; digest: string;
}
export function paidExtraBranches(additional: number, included: number): number;
export function prorateMinor(input: {
  cycleMinor: number; remainingDays: number; cycleDays: number;
}): number;
```

`POST /v1/commercial/quotes` يستقبل اختيار IDs ودورة وعدد فروع/تغيير وشروط خاصة مخولة؛ لا يستقبل totals أو tax من العميل. يحسب الخادم مع principal scope، ويحفظ snapshot والسلطة المستخدمة. `GET /:id` لصاحبه/المخول فقط. العرض وحده لا يحجز خدمة ولا ينشئ فرعًا؛ B1 يحجز عند القبول بالنسخة المتوقعة. رفض العرض المنتهي أو القديم يتطلب معاينة جديدة.

- [ ] كتابة اختبارات الأرقام الدقيقة التالية والتواريخ نهاية الشهر/فبراير الكبيس وسنة كاملة، مع رفض المدخل السالب/العشري/unsafe وتجاوز السماح الكلي.

```ts
expect(paidExtraBranches(3, 1)).toBe(2)
expect(paidExtraBranches(0, 1)).toBe(0)
expect(prorateMinor({ cycleMinor: 50000, remainingDays: 15, cycleDays: 31 })).toBe(24194)
expect(prorateMinor({ cycleMinor: 0, remainingDays: 15, cycleDays: 31 })).toBe(0)
expect(() => prorateMinor({ cycleMinor: 50000, remainingDays: 32, cycleDays: 31 }))
  .toThrow('invalid_billing_period')
```

- [ ] بناء الحساب الدقيق ووحدة calendar periods وفق policy revision. يحسب فرق عدد الفروع المدفوعة بين الحال والهدف، لا عدد الفروع المضافة فقط؛ منع إعادة منح المجاني عند تكرار الطلب أو كل فاتورة.
- [ ] تطبيق أولوية الأسعار والحدود والخصومات بترتيب موثق، ورفض العملة المختلفة. تخزين tax_policy_revision_id ضمن مرجع policy ومصدر حساب الضرائب عند اعتماده؛ القيم غير المعتمدة لا تنتج فاتورة رسمية.
- [ ] حفظ expiry والدلالة التجارية للـdigest ونسخة الاشتراك ومدخلات الحساب؛ لا يعاد حساب quote مقبول من أسعار اليوم. السياسة الزمنية تفرق عرض التغيير والمبلغ الفعلي بعد تفعيل B3/B4.
- [ ] عرض PriceBreakdown نفسه في مدير SaaS وواجهة العميل: أساس، حزم مشمولة/مدفوعة، مقر، عدد المجاني والمدفوع، سعر الفرع، الأيام، الضريبة إن مهيأة، المبلغ الآن، المبلغ والتاريخ القادم.
- [ ] تحقق حالات المنحة الخاصة السعر=0، إعفاء فرع، اختلاف سعر عميل، تداخل الحزم، زيادة الحد مع دون رسوم، quote منتهي أو revision متأخر، quote لعميل آخر. لا يجوز حجب breakdown في النجاح أو الخطأ.

**قبول A4:** تتطابق الحسابات مع الأمثلة والمعاينة بعد إعادة التحميل، ولا يستطيع تعديل HTML/طلب HTTP شراء خدمة بسعر أو ضريبة مزورة. الشرط اليومي المعتمد منفذ، والتفاصيل المقترحة في مواصفات السياسة محسومة أولًا.

## التحقق والتسليم

تشغيل المنسق بعد تجميع الدفعة، من جذر التنفيذ:

```sh
npm -w packages/commercial-contracts run test
npm -w packages/commercial-contracts run build
npm -w apps/control-plane test -- src/__tests__/commercial-catalog.test.ts src/__tests__/commercial-bundles.test.ts src/__tests__/commercial-plans.test.ts src/__tests__/commercial-quotes.test.ts
npm -w apps/control-plane run build
npm -w apps/web run test
npm -w apps/web run lint
```

الملفات التي تعتمد PostgreSQL تستخدم إعداد scratch مستقل، وينشئ المنسق fixture migration من نسخة 011 إلى 012 ويثبت SQL constraints. لا تشغّل suite قبل كتابة ملفاتها؛ عند التنفيذ ينشأ لكل اسم أعلاه اختبار بحسب مسؤوليته. المتصفح الحقيقي للحزم والباقات جزء من القبول، مع 390/768/1440 وRTL/EN وثيمات التصميم الثلاثة ولوحة المفاتيح. تسلم الأدلة في `docs/verification/saas-commercial-a.md` مع SHA وحالة dirty والموارد والأوامر والنتيجة الفعلية.
