# Nasq UX Foundations Implementation Plan — خطة الأساس الموحّد

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after owner approval. Delegation is optional only when separately authorized and ownership is isolated; this document does not dispatch agents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** توحيد التنقل، وتوزيع المعلومات والإجراءات، ورحلات الإنشاء والتعديل والحفظ والرجوع في واجهة نسق قبل مراجعة وظائف التطبيقات.

**Architecture:** تطوير الغلاف والقوالب والمساعدات الحالية في مكانها، ثم اعتمادها عبر المستهلكين دون مسارات تنفيذ موازية. تُستمد الوجهات والصلاحيات من التعريفات والخادم، ويحفظ URL أصل الرحلة. لا API جديد أو تغيير بيانات أعمال ضمن هذه الخطة.

**Tech Stack:** Nuxt 4، Vue 3، Nuxt UI 4، Vue Router، TanStack Vue Query، Storybook، Vitest، Playwright؛ بالإصدارات المثبتة في المستودع وقت التنفيذ، دون ترقية ضمن المهمة.

**Spec:** [تصور الأساس الموحّد](../specs/2026-10-15-nasq-ux-foundations-design.md)، وقد اعتمده المالك في المحادثة بتاريخ 2026-10-15.

**الحالة الحالية:** اعتمد المالك التصور والخطة في المحادثة بتاريخ 2026-10-15 وفوّض التنفيذ بالترتيب في نسخة معزولة مع تحقق بعد كل مرحلة، دون إعادة تصميم التطبيقات ودون commit أو دمج. نُفّذ الأساس وتحقّق محليًا على دفعات. [سجل التحقق وتغطية الصفحات](../../verification/2026-10-15-ux-foundations-coverage.md) يحدد الدليل والحدود؛ البنود المركبة غير المكتملة تبقى مفتوحة، وخصوصًا لوحة مفاتيح الجوال وتجربة المالك.

**تحديث التفويض:** بعد التحقق المحلي، فوّض المالك حفظ العمل الحالي بكومتات منظمة ثم تنفيذ خطة مهامي. يستمر منع الدمج وpush والنشر؛ عبارات دون كومت السابقة تسجل حدود مرحلة التنفيذ الأصلية.

## Global Constraints

- هذه الوثيقة تصف السلوك المستهدف. تظل DESIGN.md سياسة الواجهة النافذة.
- النطاق التشغيلي واجهة العميل `apps/web`.
- لا مكتبة واجهة جديدة، ولا نسخ v2، ولا feature flags للاحتفاظ بالسلوك القديم.
- لا API جديد أو تغيير صلاحيات أو مخطط بيانات أو دمج موارد المهام.
- أي نقل جارٍ للمكونات إلى `packages/ui` أو فصل إدارة البائع يعتمد على دمج عمل مالكه أولًا؛ لا ننسخ المكونات.
- تبقى `/new` داخل `SharedCreatePanel` من نهاية القراءة؛ الجوال بعرض الشاشة.
- تبقى التعديلات المركبة صفحة كاملة.
- يحمل السجل `returnTo`، ويحمل التعديل `listOrigin` لأصل السجل. لا معاملات جديدة موازية، ولا تكرار لنفس الأصل داخل سلسلة `returnTo`.
- لا تُعد المسودة محفوظة إلا بإقرار الخادم.
- لا يعتمد الرجوع على `history.length`، ولا تُستدعى `back()` دون معرفة الأصل.
- العربية RTL والإنجليزية LTR، الفاتح/الداكن، وأحجام الخط الثلاثة، وعروض 390/768/1440px ضمن القبول.
- يبقى اسم المشروع H1 وعنوان السجل الداخلي H2 داخل إطار المشروع.
- لا اختبارات على `odoo19`، ولا تعديل لمصدر Odoo، ولا commit/دمج/push/نشر أو حذف عمل دون تفويض الإجراء.

## Review Focus

هذه الحالات الخمس أعلى ما يستحق تحققًا مستقلًا؛ تملك كل حالة خطوة اختبار في المهمة المذكورة:

1. فتح سجل من تطبيق آخر أو من بحث كُتب قبل اكتمال debounce: الرجوع يعيد السياق الحي نفسه — T1.
2. حساب بلا PMO، أو فقد قدرته أثناء الجلسة: الرئيسية والأصل البديل يعملان دون حلقة أو رابط محمي — T1 وT4.
3. شاشة متوسطة مع اختيار طي محفوظ ثم resize/refresh: لا قفزة أو طمس لتفضيل المستخدم — T4.
4. حفظ بطيء/مكرر/منقطع أو تعارض: لا فقد قيم أو نجاح كاذب أو إعادة إنشاء تلقائية — T3.
5. نموذج طويل مع لوحة مفاتيح الجوال وحجم خط كبير: تظل الإجراءات قابلة للوصول ولا تسبق معلومات النشاط بيانات القرار — T2 وT7.

## ترتيب التسليم وملكية الملفات

الخطة مسار واحد مترابط، وليس مسارات لكل تطبيق. الكاتب المسؤول يملك الملفات المشتركة والتكامل. تكييف صفحة داخل تطبيق يقتصر على استهلاك العقد المشترك؛ أي طلب تغيير وظيفة أو بيانات يُرفع خارج هذه الخطة.

```mermaid
flowchart LR
  T0[اعتماد العقود] --> T1[أصل الرحلة]
  T1 --> T2[القوالب والتذييل]
  T2 --> T3[الحفظ والتحقق]
  T3 --> T4[الرئيسية والتنقل]
  T4 --> T5[القوائم والبحث والحالات]
  T5 --> T6[حصر وتوحيد المستهلكين]
  T6 --> T7[قبول الأساس]
```

يمكن إعداد بيانات القصص وقوائم السيناريوهات مستقلًا بعد T0. الكتابة في الغلاف والتوجيه والقوالب وملفات اللغة المشتركة متتابعة بسبب تداخل الملكية. قرار التنفيذ **inline** بسبب تداخل ملكية الغلاف والمساعدات والقوالب. أُجريت مراجعة مستقلة للقراءة فقط بعد التنفيذ، وأُغلقت ملاحظاتها دون كومت أو دمج.

| الدفعة | الناتج المراجع | بوابة الانتقال |
|---|---|---|
| 0 | التصور والقرارات ومصفوفة الرحلات | المالك يراجع الوثيقتين ويعتمد التغييرات المقترحة |
| 1 — T1–T3 | عقود رحلة ونماذج وقوالب مثبتة بقصص واختبارات | القصة التفاعلية والاختبارات الموجّهة سليمة |
| 2 — T4–T5 | تنقل واضح وقوائم وبحث وحالات متسقة | رؤية بصرية مشتركة وروابط سليمة لكل دور عينة |
| 3 — T6–T7 | جرد شامل للمستهلكين وقبول عابر للتطبيقات | كل A1–A12 له دليل، ثم مراجعة المالك للأساس |

كل مهمة تسلّم سلوكًا عاملًا لمستهلكيها الحاليين في نفس الدفعة؛ لا نغيّر مساعدًا ثم نؤجل إصلاح مستهلكيه إلى T6. التوثيق والقصص واللغة وتنظيف المسار القديم جزء من كل مهمة، لا ديون مؤجلة.

## Task 0: T0 — اعتماد التصور وتثبيت خط الأساس

**Files:** الوثيقتان الحاليتان؛ عند بدء التنفيذ فقط: `DESIGN.md` و`docs/design-system/components.md`.

**Interfaces:** يستهلك D1–D9؛ ينتج عقد تصميم نافذًا ومصفوفة قبول A1–A12. لا تغيير runtime.

- [x] يراجع المالك خصوصًا الرئيسية العامة المحدودة، وتسميات المهام، والطي على 768–1023px، والملخص التشغيلي والتذييل الثابت. يُسجل اعتماد القرار أو تعديله في الوثيقة.
- [x] عند تفويض التنفيذ، يُفحص `main` والعمل الجاري من جديد، ويُنشأ worktree للمهمة من أحدث `main` بمنافذ وقاعدة وملفات توليد مستقلة. لا يُبنى التنفيذ على افتراض بقاء `c9a91d7c` أحدث مصدر.
- [x] يُحسم مالك المكونات الفعلي بعد أي دمج لفصل البائع/`packages/ui`. إذا انتقلت، تُحدّث المسارات في الخطة أولًا؛ لا محرران للملف نفسه ولا نسختان للمكوّن.
- [ ] تُلتقط صور قبل التغيير لستة قوالب: قائمة، سجل، إنشاء قصير، إنشاء متدرج، تعديل، إعدادات. وتشمل قائمة مفلترة وسجلًا مرتبطًا بمشروع ومستخدم قراءة فقط.
- [x] تُنقل القرارات المعتمدة إلى أقسام DESIGN.md نفسها، ويزال النص المتعارض في موضعه؛ لا ملحق يجعل على المنفذ الاختيار بين قاعدتين.

**Acceptance:** وجود قرار واضح لكل D، وعدم استخدام المواصفة غير المعتمدة كإذن تغيير. لا commit تلقائي لأي وثيقة.

## Task 1: T1 — أصل رحلة واحد والرجوع الصحيح

**Files:**
- Modify: `apps/web/app/utils/recordListOrigin.ts`, `apps/web/app/utils/safeReturnTo.ts`.
- Inspect/preserve distinct parent context: `apps/web/app/utils/hrReturnTo.ts`, `apps/web/app/utils/projectNavigation.ts`؛ لا حذف سياق أعلى مختلف عن أصل السجل المباشر.
- Inspect/preserve: `apps/web/app/utils/scrollMemory.ts`, `apps/web/app/plugins/scrollMemory.client.ts`, `apps/web/app/router.options.ts`.
- Modify consumers: منشئو روابط السجل/التعديل/الإنشاء الذين يكشفهم `rg -n 'returnTo|listOrigin|projectListReturnTo' apps/web/app`، بما فيهم `pages/my-tasks/index.vue` و`pages/meetings/new.vue` و`pages/hr/employees/new.vue`.
- Test: extend `apps/web/app/utils/__tests__/safeReturnTo.test.ts`; create `apps/web/app/utils/__tests__/recordListOrigin.test.ts` and `apps/web/e2e/ux-foundations-journey.spec.ts`.
- Fixture ownership: `apps/web/e2e/my-tasks-mock.mjs`, `apps/web/e2e/my-tasks-fixtures.mjs`, `apps/web/e2e/internal-ui-audit-mock.mjs`؛ create `apps/web/e2e/support/uxFoundations.ts` لتصدير روابط fixture وأدواره وأسماءه الاصطناعية للاختبارات التالية.

**Interfaces:** تبقى `safeReturnTo(value, fallback, allowedPrefixes): string`، و`owningListBack(query, paths, hash?)`، و`recordChildTo(path, query, paths, hash?)`، و`recordParentTo(path, query, paths, hash?)`، و`recordSiblingTo(path, query, paths, hash?)` في مالكها الحالي. `paths` في مساعد أصل القائمة أسماء مسارات فعلية مقبولة: الوجهات الظاهرة من بيانات التنقل، ومسارات foundation للبحث والإشعارات، والقائمة الداخلية التي يعرفها مالك السجل؛ ليست مجرد prefixes تسمح بأي صفحة تحتها. لا استيراد تطبيق لتطبيق آخر. السجل يحمل `returnTo`، والتعديل `listOrigin`؛ مصدر الوجهة يحدد قبل الإرسال ولا يستنتج من تاريخ مجهول.

- [x] تُثبت حالة فقد المصدر ببيانات mock الحالية لمهمة المشروع 101 ومصدرها، مصدّرة من `e2e/support/uxFoundations.ts`؛ لا يتطلب العقد إعادة تسمية عنوان fixture. يفتح الاختبار قائمته باستعلام `q` ثم رابط المهمة من DOM ثم «العودة…»؛ المتوقع عنوان القائمة والاستعلام، وليس قائمة المشروع. لا يعتمد الاختبار على وجود بيانات التطوير السابقة.
- [x] يُضاف اختبار لسلسلة قائمة → سجل → تعديل → إلغاء/حفظ → سجل → قائمة؛ واختبار رابط تعديل مباشر بلا أصل، وhash وقيمة عربية فيها `&`، وأصل خارجي أو متداخل.
- [x] يُضاف اختبار قائمة أقسام مفلترة → قسم → مستند → تعديل → مستند → قسم → قائمة الأقسام، وآخر لقائمة مشاريع → مشروع → مهام → مهمة. يحفظان الأصل المباشر والأصل الأعلى المختلف دون تكرار أو دورة.
- [x] يُثبت انطلاق نقر السجل قبل انتهاء debounce باستخدام النمط الموجود في `e2e/support/tasmim6.ts`؛ تُحمل قيمة البحث الحالية، لا قيمة قديمة من route.
- [x] تُطوّر المساعدات الحالية وتُحدّث جميع مستهلكي التوقيع المتغير في هذه الدفعة. تُنقل ثوابت التطبيق من المساعد المشترك إلى مالكها عندما تُمس؛ لا خرائط تطبيقات جديدة داخل shared.
- [x] يُمرر أصل الإنشاء إلى السجل الناتج، وأصل السجل إلى التعديل والعودة منه. تُزال مفاتيح السياق المكررة لنفس الحقيقة فقط، وتبقى علاقة الأب والأصل الأعلى والبحث والعرض والنطاق وhash.
- [ ] يُختبر فقد صلاحية الأصل أثناء الجلسة: وجهة بديلة مسموحة ورسالة مفهومة دون حلقة. تُختبر أزرار المتصفح مستقلًا عن زر الرجوع وEscape، ولا يُعاد إرسال نموذج ناجح.
- [x] تُختبر استعادة scroll الحالية؛ لا تُبدل دون فشل جديد قابل للتكرار. تُحذف المساعدات المكررة التي أصبحت بلا مستهلك.

مثال عقد التعديل؛ تغطيه اختبارات المساعدات الحالية:

```ts
expect(recordParentTo('/meetings/7', {
  listOrigin: '/meetings/calendar?month=10&year=2026#day-15',
}, ['/meetings/calendar'])).toEqual({
  path: '/meetings/7',
  query: { returnTo: '/meetings/calendar?month=10&year=2026#day-15' },
})
```

**التحقق المستخدم:** من `apps/web`: `npm test -- app/utils/__tests__/safeReturnTo.test.ts app/utils/__tests__/recordListOrigin.test.ts`، ثم `E2E_BASE_URL=http://localhost:4401 npm run test:e2e -- e2e/ux-foundations-journey.spec.ts` على stack mock المعزول الموثق أدناه.

**Acceptance:** A4 وA5، مع نفس الرابط/الفلاتر/الموضع عند الرجوع؛ لا open redirect ولا helpers موازية.

## Task 2: T2 — قوالب معلومات واضحة وتذييل إنشاء ثابت

**Files:**
- Modify: `apps/web/app/components/shared/layout/{PageHeader,RecordPage,CreatePanel,FormSection}.vue`, `apps/web/app/assets/css/shell.css`.
- Modify stories: `apps/web/stories/shared/{PageHeader,RecordPage,CreatePanel}.stories.ts`.
- Modify tests: `apps/web/app/components/shared/layout/__tests__/{RecordPage,CreatePanel}.test.ts`.
- Create: `apps/web/e2e/ux-foundations-layout.spec.ts`.
- Modify direct consumers: كل نموذج ينتهي بأزرار في جسم `SharedCreatePanel`؛ وكل سجل ينقل حقول قرار إلى الملخص. المثال المثبت `apps/web/app/components/pmo/projects/ProjectCharterForm.vue` و`apps/web/app/components/pmo/tasks/TaskDetailPanel.vue` و`apps/web/app/components/pmo/tasks/TaskDetailPage.vue`.

**Interfaces:** `RecordPage` يضيف slot `summary` بعد العنوان وقبل التبويبات؛ `aside` للخصائص المساندة. يستخدم `CreatePanel` slot `footer` الموجود؛ زر submit الخارجي يحمل `form="<unique-form-id>"`. لا `summary` محلي ينسخ مصدر البيانات ولا عقد إنشاء ثانٍ.

- [x] تُضاف قصة سجل بمحتوى طويل وملخص مسؤول/موعد؛ القيم من نفس الكائن الذي تستعمله الخصائص، ويُزال عرضها المكرر من الجانب.
- [ ] تُضاف قصة إنشاء قصير وأخرى متدرجة: حقول أساسية ثم تفاصيل اختيارية مسماة، ولا يختفي حقل مطلوب داخل قسم مجهول. تُختبر السابقة/التالية مع بقاء القيم واسم الخطوة الحالية، والإلغاء دون حفظ.
- [x] تُكتب اختبارات ترتيب مناطق DOM وH1 الوحيد، وإرسال النموذج الصحيح من التذييل، وEnter، وبقاء الإلغاء وEscape ضمن الحارس.
- [x] تُنقل أزرار الإنشاء إلى footer الموجود في المكوّن المشترك، مع الإبقاء على ملكية النموذج للطلب والتحقق. تُصحح هندسة 640px الفعلية دون افتراض أن `max-w-160` يعطي 640px عند جذر 14px.
- [ ] تُختبر قصة خطوات طويلة عند 390px وخط كبير: التذييل داخل حدود العرض، وآخر حقل قابل للقراءة فوقه، ولا يتراكب مع المنطقة الآمنة أو لوحة المفاتيح. تُراجع أيضًا 768 و1440px.
- [x] يُرتب السجل: عنوان/حالة/إجراء → ملخص تشغيلي → محتوى → نشاط. تبقى تفاصيل المشروع ضمن إطاره المعتمد، ولا يُنشأ H1 ثانٍ.

مثال تحقق متصفح يضاف إلى اختبار التخطيط:

```ts
const next = page.getByRole('button', { name: 'التالي', exact: true })
const box = await next.boundingBox()
expect(box).not.toBeNull()
expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
```

**التحقق المستخدم:** من `apps/web`: `npm test -- app/components/shared/layout/__tests__/RecordPage.test.ts app/components/shared/layout/__tests__/CreatePanel.test.ts`، ثم اختبار التخطيط المعزول والقصص المعدلة.

**Acceptance:** A3 وA7؛ نموذج قصير ومتدرج يستخدمان نفس تذييل الإنشاء، مع ترتيب جوال يضع بيانات القرار أولًا.

## Task 3: T3 — حفظ وتحقق ومسودة بلغة وسلوك موحّدين

**Files:**
- Modify: `apps/web/app/components/shared/form/UnsavedChanges.vue` إذا كشف الاختبار نقصًا؛ `apps/web/app/components/shared/form/__tests__/UnsavedChanges.test.ts`.
- Modify direct consumers: `pages/settings/roles/new.vue`, `components/hr/EmployeeGeneralForm.vue`، ونماذج الإنشاء/التعديل التي يُحصيها فحص شروط تعطيل submit وحقول required.
- Existing API boundary: `apps/web/app/composables/useApi.ts` وأخطاؤه؛ لا تغيير شكل API.
- Create: `apps/web/e2e/ux-foundations-save.spec.ts`.
- Modify fixtures from T1: `apps/web/e2e/my-tasks-mock.mjs`, `apps/web/e2e/internal-ui-audit-mock.mjs`, `apps/web/e2e/support/uxFoundations.ts` لحالات التأخير والتعارض والأدوار؛ لا fixture موازٍ بطبقة هوية مختلفة.
- Modify: مفاتيح اللغة في namespace مالك النص فقط، وقصص النماذج الممسوسة.

**Interfaces:** النموذج يملك `dirty`, `pending`, أخطاء الحقول والخطأ العام من عقده الحالي. يعرض `UFormField :error` خطأ الحقل و`UAlert` الخطأ العام، ويستعمل حارس المسودة الواحد. لا بناء محرك نماذج عام أو طبقة طلبات ثانية.

- [x] يُثبت نموذج دور فارغ: الحقل المطلوب موضح، محاولة الإنشاء تعرض خطأ عنده وتركيزًا صحيحًا. يزول شرط تعطيل قائم فقط على نقص حقل لم يُشرح.
- [x] تُوحّد نصوص الأفعال: إنشاء، حفظ التغييرات، التالي، وإرسال إجراء الأعمال. يُعرض سبب التعطيل الناتج عن شرط مسبق أو قدرة، دون السماح بإجراء غير مخول.
- [x] تُختبر استجابة بطيئة بنقرتين وEnter: طلب واحد وحالة تحميل. مثال عدّ الطلبات أدناه.
- [ ] تُحاكى 422 و403 و409 و500 وانقطاع بعد الإرسال. تبقى قيم المسودة؛ 409 يعرض التعارض، وإعادة تحميل سجل متغير تستأذن قبل إسقاط التغييرات. لا إعادة تلقائية لإنشاء غير مؤكدة نتيجته.
- [x] تُختبر المغادرة من زر الإلغاء والإغلاق وEscape والتنقل العام وBack؛ البقاء يعيد التركيز ولا يصفر الحقول. حفظ ناجح يحدّث baseline قبل الانتقال.
- [x] يُختبر إعداد قائم بالحفظ التلقائي: يظهر pending ثم نجاح الخادم أو فشله في الموضع نفسه، ولا تُسمى قيمة محلية «محفوظة».

```ts
// داخل fixture اختبار بحفظ مؤجل، وليس طلبًا إلى قاعدة التطوير.
let submitted = 0
page.on('request', request => {
  if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/admin/roles') submitted++
})
await page.getByRole('button', { name: 'إنشاء دور', exact: true }).dblclick()
expect(submitted).toBe(1)
```

**التحقق المستخدم:** اختبار الحارس الموجّه، ثم `E2E_BASE_URL=http://localhost:4401 npm run test:e2e -- e2e/ux-foundations-save.spec.ts`. مسار أدوار الإدارة في المثال مثبت حاليًا في `useAdminRoles.ts`؛ يعاد فحصه عند بدء التنفيذ إذا تغير المصدر.

**Acceptance:** A5 وA6؛ سبب المتابعة أو المنع واضح، ولا فقد قيم أو نجاح مبكر أو إرسال مكرر.

## Task 4: T4 — رئيسية عامة وتنقل ومساحة عمل مستجيبة

**Files:**
- Modify: `apps/web/app/pages/index.vue`, `apps/web/app/utils/accessPolicy.ts`, `apps/web/app/composables/useShellModel.ts`.
- Modify foundation home gates: `apps/web/app/modules/registry.ts`, `apps/web/app/components/shell/noContextRoutes.ts`، واختبار `apps/web/app/components/shell/__tests__/noContextRoutes.test.ts`؛ Inspect `apps/web/app/middleware/auth.global.ts` و`apps/web/app/pages/login.vue`.
- Modify: `apps/web/app/composables/nav/{shellModules,activeRoute,breadcrumb,sidebarModel,contextSidebarState}.ts` ومالكي استعمالها في `components/shell/**`.
- Modify: `apps/web/app/modules/pmo/manifest.ts`, `apps/web/app/modules/tasks/manifest.ts` للتسمية وإزالة الرئيسية العامة من ملكية PMO فقط.
- Modify: `apps/web/app/assets/css/shell.css`, `apps/web/i18n/locales/{ar,en}/common.json`، ومفاتيح الأسماء المملوكة للتطبيق عند الحاجة.
- Extend tests: `apps/web/app/composables/nav/__tests__/{shellModules,activeRoute,breadcrumb,sidebarModel,contextSidebarState}.test.ts`.
- Extend access/feature tests: `apps/web/app/modules/__tests__/{manifests,registry}.test.ts` و`apps/web/app/modules/pmo/__tests__/manifest.test.ts`؛ التوقعات التي تخص وجهة التطبيق تبقى، وتوقعات الرئيسية العامة تتغير صراحة.
- Create: `apps/web/e2e/ux-foundations-shell.spec.ts`; modify `apps/web/stories/shell/{ShellFrame,ContextSidebar,MobileNavigation}.stories.ts`.

**Interfaces:** الوجهات من `useNav` و`useShellModel`، والإجراءات من `visibleCommands` في `nav/paletteModel.ts` بعد ترشيح القدرة/الميزة/القراءة فقط؛ لا تُعرض `appCommands` الخام. home مدخل foundation مستقل، ولا import لمكوّن أو composable تطبيق من shell. يبقى `firstAllowedPath` لاختيار أول مساحة مسموحة، ويصير fallback `postLoginPath` للمستخدم الداخلي `/` مع تقديم next الصحيح؛ المستخدم غير الداخلي يحتفظ بمساره الحالي. رابط هوية الجهة وhome في الغلاف يستهدفان `/` للمستخدم الداخلي. لا تُستبدل استعمالات fallback الأخرى عشوائيًا، ولا تُنشأ حلقة بين `/` و`/account`.

- [x] تُثبت اختبارات رئيسية مستخدم داخلي بلا PMO، ومستخدم بقدرات جزئية، وحساب بلا مساحات، ورابط next مشروع مسموح وآخر ممنوع.
- [x] تُحوّل `/` إلى مدخل الروابط والإجراءات الحالية. لا counters أو recent items أو استدعاءات API جديدة. تُنقل «نظرة عامة على المشاريع» إلى تنقل المشاريع دون نسخ الصفحة.
- [x] تُطبّق أسماء نطاقات المهام في التنقل والعناوين والبحث والاختصارات معًا؛ تبقى المسارات وعقود المورد والصلاحيات نفسها.
- [x] يُطبّق الافتراضي المطوي للشاشة المتوسطة دون كتابة كوكي resize، مع احترام `open/closed` الصريح. في غياب كوكي، تُضبط الهندسة CSS أولًا ويظل SSR والهيدر قابلين للاستخدام.
- [x] تُختبر الزيارات بعروض 767 و768 و1023 و1024px، ثم resize وrefresh لتفضيل مفتوح وآخر مغلق. لا يغير تبديل العرض اختيار المستخدم.
- [x] تُقاس مساحات ضغط إجراءات التنقل والإكمال في وضع اللمس: لا تقل عن 44×44px، دون تكبير كثافة سطح المكتب أو إخراج التحكم من حدود الصفحة.
- [ ] تُختبر لوحة المحادثات المتخصصة والدرج الواحد على الجوال، والتركيز بعد التنقل وحماية المسودة واختصارات لوحة مفاتيح عربية/لاتينية.

**التحقق المستخدم:** اختبارات nav المذكورة، ثم shell browser test؛ مراجعة القصص بالعربية والإنجليزية والوضعين. `npm -w apps/web run lint` من جذر worktree بعد هذه الدفعة لتغيير التوجيه والقوالب.

**Acceptance:** A1 وA2 وA8 وA11؛ لا ربط للرئيسية بميزة PMO ولا تراجع لتفضيل الطي أو الوصول.

## Task 5: T5 — القوائم والبحث والحالات

**Files:**
- Modify: `apps/web/app/components/shared/data/{FilterBar,DataTable,Pagination}.vue` حسب مسؤوليتها، و`apps/web/app/components/shared/feedback/{PageState,EmptyState}.vue`.
- Modify: `apps/web/app/components/shell/GlobalSearch.vue`, `apps/web/app/pages/search.vue`, `apps/web/app/composables/useAppSearch.ts`, `apps/web/app/modules/{types,surfaces}.ts`, `apps/web/app/modules/pmo/search.ts`.
- Modify stories: `apps/web/stories/shared/{FilterBar,PageState,ListPage}.stories.ts`, `apps/web/stories/shell/GlobalSearch.stories.ts`.
- Extend tests: `apps/web/app/components/shared/data/__tests__/FilterBar.test.ts`, `apps/web/app/components/shared/feedback/__tests__/PageState.test.ts`, `apps/web/app/composables/nav/__tests__/paletteModel.test.ts`.
- Create: `apps/web/e2e/ux-foundations-list-search.spec.ts`.

**Interfaces:** `FilterBar` يحافظ على `clear` ويغير دلالة عرضه؛ `PageState` يتيح تمرير وصف وإجراء فراغ إلى `EmptyState` القائم، دون حالة فراغ ثانية. `useAppSearch` و`searchProviders` يعرضان المزودات الحالية على السطحين؛ تزال `dialogOnly` إذا زال آخر استعمال، ولا تبقى خاصية مهجورة. تستخدم صفحة البحث query `q` و`provider`، حيث provider معرّف مزود مسجل مسموح، والمجهول يعود إلى جميع المزودات المسموحة.

- [ ] تُكتب اختبارات مسح الفلاتر يحفظ view وتحديد الصفوف، وتغيير فلتر يصفر الترقيم فقط. يظهر زر المسح باسم واضح ولون محايد.
- [ ] تُضاف قصص فراغ أول استخدام مع إنشاء مسموح، وفراغ بحث مع مسح، و403 و404، وفشل تحديث لاحق مع بقاء البيانات السابقة. لا CTA غير مخول.
- [x] يُوحّد البحث على نفس المزودات والنطاقات الحالية. قبل الكتابة وجهات وإجراءات؛ بعد الكتابة خمس نتائج لكل مزود مع عرض المزيد وحالة حد النتائج.
- [x] يُختبر نص واحد في النافذة والصفحة: نفس أنواع النتائج، مع pagination للمزود القابل للترقيم وحد صريح لغيره. provider غير معروف أو غير مسموح لا ينتج استدعاء أو تسريب بيانات.
- [x] يُختبر فتح نتيجة ثم الرجوع إلى نفس `q/provider`، وفشل مزود واحد مع بقاء نتائج غيره، وغياب قدرات المهام مع بقاء البحث المتاح.
- [x] تُحدّث جميع المستهلكات المباشرة لخصائص الحالة/البحث المتغيرة في الدفعة نفسها، وتُزال المفاتيح والخصائص المنتهية.

**التحقق المستخدم:** اختبارات الوحدات المذكورة، واختبار القائمة/البحث المعزول؛ فحص بصري للقصص المعدلة. لا إضافة مزود بحث جديد لمحتوى تطبيق.

**Acceptance:** A9 وA10 مع وضوح عدد النتائج ونطاقها والإجراء التالي من الحالات الفارغة.

## Task 6: T6 — تطبيق العقود على جميع مستهلكي الصفحات

**Files:** مستهلكو العقود في `apps/web/app/pages/**` ومكوّنات النماذج/السجلات المالكة لها، وقصصها واختباراتها ومفاتيح لغتها. Created: `docs/verification/2026-10-15-ux-foundations-coverage.md`.

**Interfaces:** لا عقود جديدة؛ يستخدم نتائج T1–T5. صفحات الطباعة والمحادثات والإطارات المتخصصة استثناء توزيع مبرر، وليست استثناء للرجوع أو الصلاحيات أو حماية المسودة.

- [x] يُعاد الجرد من المصدر الحالي باستخدام `rg --files apps/web/app/pages -g '*.vue'`؛ عدد 147 دليل سابق لا عدد قبول ثابت بعد دمج أعمال أخرى.
- [x] يُسجل لكل ملف: نوع السطح، القالب الفعلي بما فيه delegation، أصل الدخول، نتيجة الحفظ/الإلغاء/الرجوع، طريقة الحفظ، حالات الخطأ، قصة/اختبار يثبت السلوك، ومالك الاستثناء إن وجد.
- [x] تُراجع الفجوات حسب نوع الرحلة: جميع القوائم، جميع الإنشاءات، جميع التعديلات، جميع السجلات، ثم الحالات المتخصصة؛ لا تصميم تطبيق كامل بالتتابع.
- [x] تُكيّف الصفحة ميكانيكيًا للعقد المشترك: تمرير الأصل/الملخص/التذييل/الأخطاء والتسميات. إن احتاجت قرار أعمال أو endpoint أو capability أو schema، يُسجل كطلب مستقل ولا يُخترع قرار ضمن هذه الخطة.
- [x] يُرفض إغلاق الدفعة مع helper مكرر أو prop مهجور أو locale key غير مستخدم في الملفات المملوكة. لا إضافات arch baseline أو suppressions لتجاوز الفحص.
- [ ] تُجرى walkthrough لرحلة قائمة عادية، ورحلة عبر مصدرين، ورحلة ذات إطار متداخل، ورحلة حفظ تلقائي، ورحلة قراءة فقط، باستخدام بيانات اصطناعية معزولة.

**Acceptance:** A12، مع صفر صفوف جرد غير مصنفة. الاستثناء يسمي السبب والسلوك البديل والدليل؛ «يُراجع داخل التطبيق لاحقًا» لا يغطي خللًا في عقد الأساس.

## Task 7: T7 — القبول المشترك وتسليم أساس قابل للمراجعة

**Files:** تقرير التحقق أعلاه، القصص والاختبارات التي تملك الدليل، و`docs/design-system/catalog.json` إن تغيّرت واجهات مكونات/قصص. لا توثيق نجاح قبل تشغيل الفحص فعليًا.

- [x] تُشغّل الاختبارات الموجهة بعد كل مهمة؛ وعند استقرار الدفعة كلها يشغّل المسؤول `npm test` و`npm -w apps/web run lint` مرة واحدة، دون تكرار كامل في كل حزمة.
- [x] تُشغّل `python3 -B tools/ui_policy.py` و`python3 -B tools/arch_policy.py --base main`. عند التحضير لتكامل مفوض لاحقًا تضاف بوابات Git/الدمج المنصوص عليها في AGENTS.md؛ لا دمج ضمن هذا الطلب.
- [x] يُولّد الكتالوج عبر `node tools/ui_catalog.mjs` بعد تعديل القصص/المكونات وتراجع فروقه. يُبنى Storybook وتُشغّل اختبارات RTL القائمة ولقطات القوالب المركزية في مصفوفة 36 حالة.
- [x] تُشغّل ملفات `ux-foundations-*.spec.ts` على البيئة المعزولة، مع استمرار اختبارات الرحلات السابقة ذات الصلة. تُسجل mocks بدليلها وحدودها؛ قبول الخادم إن لزم لا يتم على dev DB.
- [ ] تُراجع لوحة مفاتيح فعلية: Tab/Shift+Tab/Enter/Escape، والتركيز بعد الفشل/التنقل/البقاء، ومع `prefers-reduced-motion`.
- [ ] تُختبر لوحة مفاتيح الجوال الظاهرة وحجم الخط الكبير في جهاز/محاكي إن توفر. اختبار viewport وحده لا يثبت سلوك لوحة المفاتيح؛ إن لم يتوفر يُذكر ذلك كفجوة قبول.
- [ ] يُجمع دليل لكل A1–A12: الأمر/النتيجة، أو لقطة ومسار وخطوات، مع الدور والمظهر واللغة والعرض. أي بند بلا دليل يبقى غير مقبول.
- [ ] يعرض المالك ثلاث رحلات كاملة: الوصول للعمل → فتحه والرجوع، إنشاء → خطأ → تصحيح → نجاح، تعديل → تعارض/مغادرة → استكمال. تسجل مواضع الالتباس وعدد الرجوع الخاطئ وإعادة إدخال الفلاتر؛ لا تُنسب مكاسب زمنية دون مقارنة.

**Acceptance:** قرار قبول صريح للأساس ومصفوفة مكتملة، ثم فقط يبدأ نطاق مراجعة التطبيقات. نتائج محلية لا تثبت نشرًا أو إطلاقًا.


**تفسير البنود المفتوحة بعد التنفيذ:** لم تكتمل مجموعة صور جديدة قبل التغيير. اجتازت رحلات الإنشاء السابقة/التالية وحفظ القيم والإلغاء، وأخطاء الحفظ 422/403/409/500 والانقطاع، والحفظ التلقائي وفشله وإعادة محاولته. بعض البنود أعلاه تجمع ذلك مع تجربة جهاز أو أدوار أو أدوات إدخال أوسع لم تُشغّل كلها؛ بقيت مفتوحة بدل نسب دليل غير موجود. اختبار تراجع الصلاحيات للمصدر موجود كوحدة تفاعلية reactive، وليس walkthrough متصفحًا كاملًا لكل دور. القبول اليدوي للمالك ولوحة مفاتيح الجوال الظاهرة ما زالا مطلوبين؛ راجع سجل التغطية للحدود الدقيقة.

## بيئة التحقق المستخدمة

لنسخة التنفيذ `node_modules` و`.nuxt` مستقلان عبر `npm ci --ignore-scripts`؛ لا تعديل لـ `~/.npmrc`.

نمط بيئة اختبارات المتصفح، بعد التحقق من فراغ المنافذ 4501 و5501 و4401 وحجزها:

```sh
# من جذر worktree، عملية mock مستقلة
MOCK_PORT=4501 node apps/web/e2e/my-tasks-mock.mjs
```

```sh
# من apps/web في worktree نفسه، عملية Nuxt مستقلة
NUXT_ODOO_URL=http://127.0.0.1:4501 NUXT_ODOO_DB=nasq_ui_mock_only \
NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4501/websocket npm run dev -- --port 4401
```

```sh
# من apps/web، بعد جاهزية /login
E2E_MY_TASKS=1 E2E_BASE_URL=http://localhost:4401 npm run test:e2e -- \
  e2e/ux-foundations-journey.spec.ts e2e/ux-foundations-layout.spec.ts \
  e2e/ux-foundations-save.spec.ts e2e/ux-foundations-shell.spec.ts \
  e2e/ux-foundations-list-search.spec.ts
```

تضاف حالات المستخدم بلا PMO/القراءة فقط وتأخير الحفظ/التعارض إلى fixture mock من جهة الخادم التي يقرأها SSR، مع الحالات المعرّفة في الاختبارات؛ لا يكفي اعتراض browser request لتغيير `/me` أثناء SSR. لا تُستخدم جلسة إدارية حقيقية كدليل قبول أدوار الآخرين.

## جدول تتبع التصور

| التصور | مهمة التنفيذ | القبول |
|---|---|---|
| D1 | T4 | A1 |
| D2 | T4، T6 | A2، A3 |
| D3 | T2، T4، T7 | A7، A8، A11 |
| D4 | T2، T6 | A3، A7، A12 |
| D5 | T2، T3 | A5، A7 |
| D6 | T1 | A4، A5 |
| D7 | T3 | A5، A6 |
| D8 | T5، T6 | A10، A12 |
| D9 | T5 | A9 |
| شمول الصفحات والحدود والملكية | T0، T6، T7 | A11، A12 |

## حدود التسليم الحالي

اعتمد المالك التصور والخطة وفوّض تنفيذ الأساس في النسخة المعزولة بالترتيب مع التحقق بعد كل مرحلة. لا تُعلّم خانة مكتملة إلا بدليل. يستمر منع commit والدمج وpush والنشر وإعادة تصميم التطبيقات.
